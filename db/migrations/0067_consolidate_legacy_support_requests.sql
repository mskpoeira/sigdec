DO $$
BEGIN
  IF to_regclass('public.operational_support_requests') IS NOT NULL THEN
    INSERT INTO external_support_requests(
      organization_id,scope,service_type,incident_id,cobrade_code,title,summary,status,
      external_system,external_protocol,reference_url,submitted_at,approved_at,
      responsible_user_id,created_by,created_at,updated_at
    )
    SELECT
      s.organization_id,
      CASE WHEN s.request_type='STATE_SUPPORT' THEN 'STATE' ELSE 'OTHER' END,
      CASE s.request_type
        WHEN 'HUMANITARIAN_AID' THEN 'STATE_HUMANITARIAN'
        WHEN 'EMERGENCY_INSPECTION' THEN 'STATE_EMERGENCY_INSPECTION'
        WHEN 'STATE_SUPPORT' THEN 'STATE_EMERGENCY_SUPPORT'
        ELSE 'OTHER'
      END,
      s.incident_id,
      NULL,
      'Solicitação migrada · ' || replace(initcap(replace(s.request_type,'_',' ')),'Aid','AID'),
      s.justification,
      CASE s.status
        WHEN 'DRAFT' THEN 'DRAFT'
        WHEN 'SUBMITTED' THEN 'SUBMITTED'
        WHEN 'IN_ANALYSIS' THEN 'UNDER_REVIEW'
        WHEN 'APPROVED' THEN 'APPROVED'
        WHEN 'REJECTED' THEN 'REJECTED'
        WHEN 'COMPLETED' THEN 'CLOSED'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        ELSE 'DRAFT'
      END,
      s.destination,
      s.external_protocol,
      'legacy://operational-support/' || s.id::text,
      s.submitted_at,
      CASE WHEN s.status IN ('APPROVED','COMPLETED') THEN s.resolved_at ELSE NULL END,
      NULL,
      s.created_by,
      s.created_at,
      COALESCE(s.updated_at,s.created_at)
    FROM operational_support_requests s
    WHERE NOT EXISTS (
      SELECT 1
      FROM external_support_requests e
      WHERE e.reference_url='legacy://operational-support/' || s.id::text
    );

    INSERT INTO external_support_requirements(
      organization_id,request_id,code,title,required,status,notes,created_by,created_at,updated_at
    )
    SELECT
      e.organization_id,
      e.id,
      'LEGACY_ITEM_' || lpad(items.ordinality::text,3,'0'),
      COALESCE(NULLIF(items.item->>'name',''),'Item/necessidade migrada'),
      true,
      CASE WHEN e.status IN ('APPROVED','CLOSED') THEN 'ACCEPTED' ELSE 'MISSING' END,
      NULLIF(trim(concat_ws(' ',items.item->>'quantity',items.item->>'unit')),''),
      e.created_by,
      e.created_at,
      e.updated_at
    FROM external_support_requests e
    JOIN operational_support_requests s
      ON e.reference_url='legacy://operational-support/' || s.id::text
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.requested_items,'[]'::jsonb))
      WITH ORDINALITY AS items(item,ordinality)
    ON CONFLICT(request_id,code) DO NOTHING;

    COMMENT ON TABLE operational_support_requests IS
      'LEGACY: registros migrados para external_support_requests. Mantida somente para preservação histórica.';
  END IF;
END
$$;

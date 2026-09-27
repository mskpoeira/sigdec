-- SIGDEC v1.71 — Inteligência Jurídica, IA assistiva e integração SEI Cidades

INSERT INTO permissions(code,description) VALUES
('legal.read','Consultar base legal e contexto normativo do SIGDEC'),
('legal.manage','Gerenciar e verificar normas da base legal do SIGDEC'),
('ai.report.generate','Gerar minutas técnicas assistidas por IA'),
('ai.report.review','Revisar e aprovar minutas técnicas assistidas por IA'),
('sei.read','Consultar vínculos e tramitação no SEI Cidades'),
('sei.manage','Configurar e operar integração com SEI Cidades')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='MASTER' AND p.code IN(
 'legal.read','legal.manage','ai.report.generate','ai.report.review','sei.read','sei.manage'
)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS legal_norms(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
 jurisdiction varchar(20) NOT NULL CHECK(jurisdiction IN('FEDERAL','STATE','MUNICIPAL')),
 state_code char(2),
 municipality varchar(160),
 norm_type varchar(80) NOT NULL,
 norm_number varchar(80) NOT NULL,
 norm_year integer,
 title text NOT NULL,
 summary text,
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','REVOKED','SUPERSEDED','DRAFT')),
 source_url text NOT NULL,
 official_source varchar(240) NOT NULL,
 publication_date date,
 effective_from date,
 effective_to date,
 topics jsonb NOT NULL DEFAULT '[]'::jsonb,
 full_text text,
 source_hash char(64),
 verified_at timestamptz,
 verification_notes text,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_norms_identity_uidx
 ON legal_norms(COALESCE(organization_id,'00000000-0000-0000-0000-000000000000'::uuid),jurisdiction,COALESCE(state_code,''),COALESCE(municipality,''),norm_type,norm_number,COALESCE(norm_year,0));
CREATE INDEX IF NOT EXISTS legal_norms_topics_gin ON legal_norms USING gin(topics);
CREATE INDEX IF NOT EXISTS legal_norms_search_gin ON legal_norms USING gin(to_tsvector('portuguese',coalesce(title,'')||' '||coalesce(summary,'')||' '||coalesce(full_text,'')));

CREATE TABLE IF NOT EXISTS legal_norm_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 norm_id uuid NOT NULL REFERENCES legal_norms(id) ON DELETE CASCADE,
 version_label varchar(120),
 source_url text NOT NULL,
 full_text text,
 source_hash char(64),
 verified_at timestamptz NOT NULL DEFAULT now(),
 verification_notes text,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS technical_report_drafts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 entity_type varchar(80),
 entity_id uuid,
 report_type varchar(40) NOT NULL CHECK(report_type IN('FIELD_INSPECTION','RISK_ASSESSMENT','EMERGENCY','DAMAGE','INTERDICTION','SITREP','GENERAL')),
 title text NOT NULL,
 context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 legal_context jsonb NOT NULL DEFAULT '[]'::jsonb,
 draft_text text NOT NULL,
 ai_assisted boolean NOT NULL DEFAULT false,
 ai_provider varchar(80),
 ai_model varchar(160),
 status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','IN_REVIEW','APPROVED','REJECTED','ARCHIVED')),
 created_by uuid NOT NULL REFERENCES users(id),
 reviewed_by uuid REFERENCES users(id),
 approved_by uuid REFERENCES users(id),
 reviewed_at timestamptz,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS technical_report_drafts_incident_idx ON technical_report_drafts(incident_id,created_at DESC);
CREATE INDEX IF NOT EXISTS technical_report_drafts_org_status_idx ON technical_report_drafts(organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS ai_interactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES users(id),
 report_id uuid REFERENCES technical_report_drafts(id) ON DELETE SET NULL,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 purpose varchar(80) NOT NULL,
 provider varchar(80) NOT NULL,
 model varchar(160),
 prompt_hash char(64),
 input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 output_hash char(64),
 latency_ms integer,
 input_tokens integer,
 output_tokens integer,
 result varchar(20) NOT NULL CHECK(result IN('SUCCEEDED','FALLBACK','FAILED')),
 error_message text,
 human_decision varchar(20) CHECK(human_decision IN('ACCEPTED','CORRECTED','REJECTED')),
 human_decision_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_interactions_org_created_idx ON ai_interactions(organization_id,created_at DESC);

CREATE TABLE IF NOT EXISTS sei_connections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name varchar(160) NOT NULL,
 base_url text NOT NULL,
 wsdl_url text NOT NULL,
 system_code varchar(120) NOT NULL,
 service_key_ciphertext text,
 unit_id varchar(80) NOT NULL,
 active boolean NOT NULL DEFAULT true,
 allowed_operations jsonb NOT NULL DEFAULT '[]'::jsonb,
 config jsonb NOT NULL DEFAULT '{}'::jsonb,
 last_test_at timestamptz,
 last_test_ok boolean,
 last_test_message text,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,name)
);

CREATE TABLE IF NOT EXISTS sei_process_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES sei_connections(id) ON DELETE CASCADE,
 incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
 entity_type varchar(80),
 entity_id uuid,
 sei_process_id varchar(120),
 sei_protocol varchar(160) NOT NULL,
 sei_url text,
 process_type_id varchar(120),
 process_type_name varchar(300),
 status varchar(40) NOT NULL DEFAULT 'LINKED',
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 last_synced_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,sei_protocol)
);
CREATE INDEX IF NOT EXISTS sei_process_links_incident_idx ON sei_process_links(incident_id,created_at DESC);

CREATE TABLE IF NOT EXISTS sei_document_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 process_link_id uuid NOT NULL REFERENCES sei_process_links(id) ON DELETE CASCADE,
 report_id uuid REFERENCES technical_report_drafts(id) ON DELETE SET NULL,
 attachment_id uuid REFERENCES incident_attachments(id) ON DELETE SET NULL,
 sei_document_id varchar(120),
 sei_document_protocol varchar(160),
 sei_url text,
 document_type_id varchar(120),
 document_type_name varchar(300),
 content_hash char(64),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sei_operation_logs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES sei_connections(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES users(id),
 operation varchar(120) NOT NULL,
 entity_type varchar(80),
 entity_id uuid,
 request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
 response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
 success boolean NOT NULL,
 error_message text,
 duration_ms integer,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sei_operation_logs_org_created_idx ON sei_operation_logs(organization_id,created_at DESC);

INSERT INTO legal_norms(jurisdiction,state_code,municipality,norm_type,norm_number,norm_year,title,summary,status,source_url,official_source,topics,verified_at,verification_notes)
VALUES
('FEDERAL',NULL,NULL,'Lei','12.608',2012,'Política Nacional de Proteção e Defesa Civil - PNPDEC','Institui a PNPDEC, o SINPDEC e estabelece diretrizes de prevenção, mitigação, preparação, resposta e recuperação.','ACTIVE','https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12608.htm','Presidência da República','["defesa_civil","risco","desastre","planejamento","monitoramento"]'::jsonb,now(),'Fonte oficial cadastrada; conferir texto consolidado antes de citação conclusiva.'),
('FEDERAL',NULL,NULL,'Lei','12.340',2010,'Transferências para ações de resposta e recuperação','Disciplina transferências de recursos da União para ações de prevenção, resposta e recuperação em áreas atingidas por desastre.','ACTIVE','https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2010/lei/l12340.htm','Presidência da República','["defesa_civil","recursos","reconhecimento","recuperacao"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','14.750',2023,'Aprimoramento da legislação de proteção e defesa civil','Altera normas nacionais de proteção e defesa civil, prevenção e gestão de riscos e desastres.','ACTIVE','https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14750.htm','Presidência da República','["defesa_civil","prevencao","risco","desastre"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','10.257',2001,'Estatuto da Cidade','Regulamenta a política urbana e instrumentos de ordenamento territorial e planejamento municipal.','ACTIVE','https://www.planalto.gov.br/ccivil_03/leis/leis_2001/l10257.htm','Presidência da República','["urbanismo","plano_diretor","uso_solo","habitacao","risco"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','6.766',1979,'Parcelamento do Solo Urbano','Dispõe sobre parcelamento do solo urbano e restrições relevantes à ocupação de áreas inadequadas.','ACTIVE','https://www.planalto.gov.br/ccivil_03/leis/l6766.htm','Presidência da República','["parcelamento","urbanismo","uso_solo","risco"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','12.651',2012,'Código Florestal','Estabelece normas gerais sobre proteção da vegetação, APPs e áreas ambientalmente protegidas.','ACTIVE','https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12651.htm','Presidência da República','["meio_ambiente","app","vegetacao","ocupacao"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','6.938',1981,'Política Nacional do Meio Ambiente','Institui a Política Nacional do Meio Ambiente e seus instrumentos.','ACTIVE','https://www.planalto.gov.br/ccivil_03/leis/l6938.htm','Presidência da República','["meio_ambiente","licenciamento","impacto"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','9.605',1998,'Lei de Crimes Ambientais','Dispõe sobre sanções penais e administrativas derivadas de condutas lesivas ao meio ambiente.','ACTIVE','https://www.planalto.gov.br/ccivil_03/leis/l9605.htm','Presidência da República','["meio_ambiente","fiscalizacao","dano_ambiental"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','13.465',2017,'Regularização Fundiária - REURB','Dispõe, entre outros temas, sobre regularização fundiária urbana e procedimentos aplicáveis.','ACTIVE','https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2017/lei/l13465.htm','Presidência da República','["habitacao","regularizacao_fundiaria","urbanismo","ocupacao"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','11.445',2007,'Diretrizes Nacionais para o Saneamento Básico','Estabelece diretrizes nacionais para saneamento básico, drenagem e serviços correlatos.','ACTIVE','https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2007/lei/l11445.htm','Presidência da República','["saneamento","drenagem","inundacao","infraestrutura"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','13.709',2018,'Lei Geral de Proteção de Dados Pessoais - LGPD','Disciplina tratamento e proteção de dados pessoais, inclusive pelo Poder Público.','ACTIVE','https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm','Presidência da República','["dados_pessoais","privacidade","documentos","ia"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','12.527',2011,'Lei de Acesso à Informação - LAI','Regula o acesso a informações públicas e as hipóteses de restrição.','ACTIVE','https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2011/lei/l12527.htm','Presidência da República','["transparencia","documentos","sigilo"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('FEDERAL',NULL,NULL,'Lei','14.133',2021,'Lei de Licitações e Contratos Administrativos','Estabelece normas gerais de licitação e contratação, inclusive hipóteses de contratação direta em emergência.','ACTIVE','https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm','Presidência da República','["contratacao","emergencia","recursos","obras"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('STATE','SP',NULL,'Decreto','64.592',2019,'Sistema Estadual de Proteção e Defesa Civil - SIEPDEC','Reorganiza a Política e o Sistema Estadual de Proteção e Defesa Civil do Estado de São Paulo.','ACTIVE','https://www.al.sp.gov.br/repositorio/legislacao/decreto/2019/decreto-64592-14.11.2019.html','Assembleia Legislativa do Estado de São Paulo','["defesa_civil","siepdec","ppdc","monitoramento"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('STATE','SP',NULL,'Decreto','62.913',2017,'Zoneamento Ecológico-Econômico do Litoral Norte','Dispõe sobre o Zoneamento Ecológico-Econômico do Setor do Litoral Norte e regras territoriais e ambientais.','ACTIVE','https://www.al.sp.gov.br/repositorio/legislacao/decreto/2017/decreto-62913-08.11.2017.html','Assembleia Legislativa do Estado de São Paulo','["zee","meio_ambiente","zoneamento","litoral_norte","uso_solo"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('STATE','SP',NULL,'Lei','18.068',2024,'Fundo Estadual de Proteção e Defesa Civil - FUNPDeC','Institui o Fundo Estadual de Proteção e Defesa Civil do Estado de São Paulo.','ACTIVE','https://www.al.sp.gov.br/repositorio/legislacao/lei/2024/lei-18068-18.12.2024.html','Assembleia Legislativa do Estado de São Paulo','["defesa_civil","recursos","prevencao","recuperacao"]'::jsonb,now(),'Fonte oficial cadastrada.'),
('MUNICIPAL','SP','Ubatuba','Lei','711',1984,'Plano Diretor Físico / Parcelamento, Uso e Ocupação do Solo de Ubatuba','Estabelece normas municipais de parcelamento, uso e ocupação do solo e microzoneamento.','ACTIVE','https://planodiretor.ubatuba.sp.gov.br/mapa/lei-do-plano-diretor-fisico-lpuos/','Prefeitura Municipal de Ubatuba','["urbanismo","zoneamento","uso_solo","parcelamento","edificacao"]'::jsonb,now(),'Referência oficial municipal cadastrada; alterações posteriores devem ser versionadas.'),
('MUNICIPAL','SP','Ubatuba','Lei','2.892',2006,'Plano Diretor Participativo de Ubatuba','Institui o Plano Diretor Participativo e o processo de planejamento e gestão do desenvolvimento urbano.','ACTIVE','https://ubatuba.sp.gov.br/download/LEI%202892_Plano%20Diretor_Cons%20cidades.pdf','Prefeitura Municipal de Ubatuba','["plano_diretor","urbanismo","zoneamento","habitacao","meio_ambiente"]'::jsonb,now(),'Fonte oficial municipal cadastrada.'),
('MUNICIPAL','SP','Ubatuba','Lei','1.103',1991,'Sistema e processo de planejamento municipal','Disciplina sistema/processo de planejamento e participação comunitária no desenvolvimento de Ubatuba.','ACTIVE','https://planodiretor.ubatuba.sp.gov.br/legislacao/page/3/','Prefeitura Municipal de Ubatuba','["planejamento","urbanismo","participacao"]'::jsonb,now(),'Referência oficial municipal cadastrada.'),
('MUNICIPAL','SP','Ubatuba','Decreto','8.987',2026,'PLANCON de Proteção e Defesa Civil de Ubatuba','Aprova o Plano de Contingência de Proteção e Defesa Civil do Município de Ubatuba e estabelece responsabilidades de execução e revisão.','ACTIVE','https://www.ubatuba.sp.gov.br/diariooficial/decreto_8987-2026_de_2026/','Prefeitura Municipal de Ubatuba','["defesa_civil","plancon","evacuacao","resposta","alerta","abrigos"]'::jsonb,now(),'Fonte oficial municipal cadastrada.')
ON CONFLICT DO NOTHING;

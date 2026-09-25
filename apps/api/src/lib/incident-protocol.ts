const UBATUBA_TIME_ZONE = "America/Sao_Paulo";

export function incidentProtocolParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: UBATUBA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  ) as Record<string, string>;

  const year = Number(values.year);
  const month = values.month;
  const day = values.day;

  if (!Number.isInteger(year) || !month || !day) {
    throw new Error("Falha ao determinar a data local do protocolo.");
  }

  return {
    year,
    month,
    day,
    format(sequenceNo: number) {
      if (!Number.isInteger(sequenceNo) || sequenceNo < 1 || sequenceNo > 999999) {
        throw new Error("Sequência da ocorrência fora do intervalo de 000001 a 999999.");
      }
      return `DC-${year}-${month}-${day}${String(sequenceNo).padStart(6, "0")}`;
    }
  };
}

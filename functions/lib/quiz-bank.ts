export type QuizQuestion = { id: string; question: string; options: string[]; answer: string };
export type PublicQuizQuestion = Omit<QuizQuestion, "answer">;

// Answers stay in the server bundle. The browser only receives the selected
// question and its options through quiz-action.
export const QUIZ_QUESTIONS: QuizQuestion[] = [
  { id: "q01", question: "¿Qué selección ganó el Mundial de 2022?", options: ["Francia", "Argentina", "Croacia", "Brasil"], answer: "Argentina" },
  { id: "q02", question: "¿En qué país se celebró el primer Mundial, en 1930?", options: ["Italia", "Uruguay", "Brasil", "España"], answer: "Uruguay" },
  { id: "q03", question: "¿Qué selección ganó el Mundial de 2010?", options: ["Alemania", "Países Bajos", "España", "Argentina"], answer: "España" },
  { id: "q04", question: "¿Quién marcó el gol de la final del Mundial de 2010?", options: ["David Villa", "Xavi Hernández", "Fernando Torres", "Andrés Iniesta"], answer: "Andrés Iniesta" },
  { id: "q05", question: "¿Qué selección ganó la Eurocopa de 2024?", options: ["Inglaterra", "Francia", "España", "Alemania"], answer: "España" },
  { id: "q06", question: "¿Qué selección ganó la Eurocopa de 2008?", options: ["Italia", "España", "Alemania", "Grecia"], answer: "España" },
  { id: "q07", question: "¿Cuántos jugadores de cada equipo empiezan normalmente un partido?", options: ["9", "10", "11", "12"], answer: "11" },
  { id: "q08", question: "¿Cuánto dura un partido de fútbol antes del tiempo añadido y la prórroga?", options: ["80 minutos", "90 minutos", "100 minutos", "120 minutos"], answer: "90 minutos" },
  { id: "q09", question: "¿Cuánto dura cada parte del tiempo reglamentario?", options: ["40 minutos", "45 minutos", "50 minutos", "60 minutos"], answer: "45 minutos" },
  { id: "q10", question: "¿Qué significa recibir una tarjeta amarilla?", options: ["Expulsión inmediata", "Amonestación", "Gol anulado", "Cambio obligatorio"], answer: "Amonestación" },
  { id: "q11", question: "¿Qué ocurre cuando un jugador recibe una tarjeta roja?", options: ["Debe abandonar el partido", "Su equipo recibe un penalti", "Se repite la jugada", "Puede seguir si cambia de posición"], answer: "Debe abandonar el partido" },
  { id: "q12", question: "¿A qué distancia está el punto de penalti de la línea de gol?", options: ["9 metros", "10 metros", "11 metros", "12 metros"], answer: "11 metros" },
  { id: "q13", question: "¿Desde dónde se reanuda el juego después de que un equipo marque?", options: ["Desde el área pequeña", "Desde el centro del campo", "Desde la esquina", "Desde la línea de banda"], answer: "Desde el centro del campo" },
  { id: "q14", question: "Si un defensa toca el balón el último antes de que cruce su propia línea de fondo, sin ser gol, ¿qué se concede normalmente?", options: ["Saque de esquina", "Saque de puerta", "Saque de banda", "Penalti"], answer: "Saque de esquina" },
  { id: "q15", question: "Si un atacante toca el balón el último antes de que cruce la línea de fondo, sin ser gol, ¿qué se concede normalmente?", options: ["Saque de esquina", "Saque de puerta", "Saque de banda", "Balón a tierra"], answer: "Saque de puerta" },
  { id: "q16", question: "¿En qué zona puede tocar el balón con las manos el portero, salvo excepciones reglamentarias?", options: ["En cualquier parte del campo", "En su propia área penal", "Solo en el área pequeña", "En el círculo central"], answer: "En su propia área penal" },
  { id: "q17", question: "¿Qué debe ocurrir para que se señale una posición de fuera de juego?", options: ["El jugador debe estar en su propio campo", "El jugador debe estar en posición adelantada e intervenir en la jugada", "El balón debe salir por la banda", "El portero debe tocar el balón"], answer: "El jugador debe estar en posición adelantada e intervenir en la jugada" },
  { id: "q18", question: "¿Qué saque se realiza cuando el balón cruza completamente una línea de banda?", options: ["Saque de esquina", "Saque de puerta", "Saque de banda", "Saque inicial"], answer: "Saque de banda" },
  { id: "q19", question: "¿Cuándo cuenta un gol válido?", options: ["Cuando el balón toca el poste", "Cuando el balón cruza completamente la línea de gol entre los postes y bajo el larguero, sin infracción", "Cuando el balón entra en el área", "Cuando el árbitro señala córner"], answer: "Cuando el balón cruza completamente la línea de gol entre los postes y bajo el larguero, sin infracción" },
  { id: "q20", question: "¿Qué significan las siglas VAR en el fútbol?", options: ["Video Assistant Referee", "Virtual Attack Review", "Verified Action Replay", "Video Analysis Result"], answer: "Video Assistant Referee" },
  { id: "q21", question: "¿Qué sucede normalmente si un jugador ve dos tarjetas amarillas en el mismo partido?", options: ["No pasa nada", "Es expulsado", "Se anula la segunda", "Su equipo pierde un gol"], answer: "Es expulsado" },
  { id: "q22", question: "¿A qué distancia deben colocarse los rivales de un balón parado, si no se aplica otra regla específica?", options: ["5,5 metros", "7 metros", "9,15 metros", "11 metros"], answer: "9,15 metros" },
  { id: "q23", question: "¿Cómo se llama marcar tres goles en un mismo partido?", options: ["Doblete", "Trillizo", "Hat-trick", "Triplete de campo"], answer: "Hat-trick" },
  { id: "q24", question: "¿Qué significa que un portero haya mantenido la portería a cero?", options: ["Que no ha recibido goles", "Que no ha hecho paradas", "Que su equipo no ha tirado", "Que el partido se ha suspendido"], answer: "Que no ha recibido goles" },
  { id: "q25", question: "¿Qué es un gol en propia puerta?", options: ["Un gol marcado desde el área propia", "Un gol que un jugador introduce en su propia portería", "Un gol anulado por fuera de juego", "Un gol marcado de penalti"], answer: "Un gol que un jugador introduce en su propia portería" },
  { id: "q26", question: "¿Qué selección ganó el Mundial de 2018?", options: ["Croacia", "Francia", "Bélgica", "Inglaterra"], answer: "Francia" },
  { id: "q27", question: "¿Qué selección ganó el Mundial de 2014?", options: ["Argentina", "Brasil", "Alemania", "Países Bajos"], answer: "Alemania" },
  { id: "q28", question: "¿De qué país es Lionel Messi?", options: ["Uruguay", "Argentina", "España", "Chile"], answer: "Argentina" },
  { id: "q29", question: "¿De qué país es Cristiano Ronaldo?", options: ["Brasil", "Portugal", "Argentina", "Italia"], answer: "Portugal" },
  { id: "q30", question: "¿Qué resultado se produce cuando ambos equipos marcan el mismo número de goles?", options: ["Victoria", "Derrota", "Empate", "Prórroga automática"], answer: "Empate" },
];

export function publicQuizQuestion(question: QuizQuestion): PublicQuizQuestion {
  return { id: question.id, question: question.question, options: [...question.options] };
}

export function pickQuizQuestions<T>(questions: T[], randomIndex: (max: number) => number, count = 5): T[] {
  if (count > questions.length) throw new Error("No hay suficientes preguntas disponibles para el quiz.");
  const pool = [...questions];
  for (let index = pool.length - 1; index > 0; index--) {
    const swapIndex = randomIndex(index + 1);
    [pool[index], pool[swapIndex]] = [pool[swapIndex]!, pool[index]!];
  }
  return pool.slice(0, count);
}

export function secureRandomIndex(max: number) {
  if (!Number.isSafeInteger(max) || max <= 0) throw new Error("El rango aleatorio no es válido.");
  const range = 0x1_0000_0000;
  const limit = range - (range % max);
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0]! >= limit);
  return sample[0]! % max;
}

(() => {
  const formatter = new Intl.NumberFormat("es-ES");

  function formatScore(value) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return "—";
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? formatter.format(numericValue) : "—";
  }

  function setValue(id, value) {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = formatScore(value);
  }

  window.ScoreWidget = {
    render(scores = {}) {
      setValue("widget-points-3", scores["3eso"]?.points);
      setValue("widget-points-4", scores["4eso"]?.points);
      setValue("widget-goals-3", scores["3eso"]?.goals);
      setValue("widget-goals-4", scores["4eso"]?.goals);
    }
  };
})();

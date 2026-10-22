export function PageLoading({ label = "Cargando sección…" }: { label?: string }) {
  return <div className="page-loading" role="status" aria-live="polite">
    <span className="page-loading-spinner" aria-hidden="true" />
    <span className="page-loading-copy"><strong>{label}</strong><small>Un momento, estamos preparando la información.</small></span>
  </div>;
}

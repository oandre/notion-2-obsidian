export function DiscoveryProgress() {
  return (
    <div className="discovery-progress">
      <p>Descobrindo o workspace…</p>
      <p>Isso só acontece na primeira vez. Em execuções futuras, o picker carrega instantâneo.</p>
      <progress />
    </div>
  );
}

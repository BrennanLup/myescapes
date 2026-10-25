// PLACEHOLDER (orchestrator). Owned by workstream 2: Lighting.
export function Lighting() {
  return (
    <>
      <hemisphereLight args={['#ffe2c4', '#5a3a3a', 1.2]} />
      <pointLight position={[0, 3, 0]} intensity={20} color="#ffb36b" />
    </>
  )
}

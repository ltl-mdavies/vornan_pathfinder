export function assertSandboxBundleInputs(inputs) {
  const forbidden=inputs.filter(path=> /apps\/api\/src\/(?:.*\/)?(?:server|store|pdf-worker-source|pdf-inspection)\.ts$/.test(path) || /node_modules\/pdf-lib\//.test(path));
  if(forbidden.length)throw new Error('Sandbox bundle imported a shared runtime or PDF parser');
}

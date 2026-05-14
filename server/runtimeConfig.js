export function resolveRuntimeConfigEnv(env = process.env) {
  const buildEnv = env.BUILD_ENV || "production";
  const productionRuntime = String(buildEnv).toLowerCase() === "production" || env.NODE_ENV === "production";
  const requestedDataSource = env.DATA_SOURCE || (productionRuntime ? "firebase" : "mock");

  return {
    buildEnv,
    productionRuntime,
    requestedDataSource,
    dataSource: productionRuntime ? "firebase" : requestedDataSource,
  };
}

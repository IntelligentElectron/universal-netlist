// Files `bun build --compile` embeds: importing one yields its path.
declare module "*.wasm" {
  const path: string;
  export default path;
}
declare module "*.ttf" {
  const path: string;
  export default path;
}

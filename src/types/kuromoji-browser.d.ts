declare module "kuromoji/build/kuromoji.js" {
  import type { builder } from "kuromoji";
  const kuromoji: { readonly builder: typeof builder };
  export default kuromoji;
}

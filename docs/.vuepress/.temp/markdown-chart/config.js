import { defineClientConfig } from "vuepress/client";
import Mermaid from "/Users/kyle/personal/vixl/node_modules/@vuepress/plugin-markdown-chart/dist/client/components/Mermaid.js";

export default defineClientConfig({
  enhance: ({ app }) => {
    app.component("Mermaid", Mermaid);
  },
});

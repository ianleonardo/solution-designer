import Underline from "@tiptap/extension-underline";

/** Underline mark stored as `<u>…</u>` in Markdown so export and cell previews can show it. */
export const UnderlineMarkdown = Underline.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "<u>", close: "</u>", mixable: true, expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

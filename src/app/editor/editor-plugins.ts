import {
  $isTableNode, addExportVisitor$, exportLexicalTreeToMdast, exportVisitors$, insertImage$, jsxComponentDescriptors$,
  jsxIsAvailable$, realmPlugin, rootEditor$, type LexicalVisitor, type TableNode
} from '@mdxeditor/editor';
import { $getNearestNodeFromDOMNode, $getRoot, $isLineBreakNode, getNearestEditorFromDOMNode } from 'lexical';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';

type Snapshot = () => string | undefined;

export const editorPlugins = realmPlugin<{ install(snapshot: Snapshot, attach: (reference: string) => void): void }>({
  init(realm, options) {
    // MDXEditor normally emits a soft newline for a Lexical LineBreakNode.
    realm.pub(addExportVisitor$, {
      priority: 10, testLexicalNode: $isLineBreakNode,
      visitLexicalNode: ({ mdastParent, actions }) => actions.appendToParent(mdastParent,{ type: 'break' })
    });
    options?.install(() => {
      const focused = document.activeElement;
      const cell = focused?.closest('th,td');
      const row = cell?.closest('tr');
      const table = row?.closest('table');
      const root = realm.getValue(rootEditor$);
      const nested = focused && getNearestEditorFromDOMNode(focused);
      if (!root || !nested || root === nested || !row || !cell || !table || row.parentElement?.tagName !== 'TBODY') return;
      if (!root.getRootElement()?.contains(table)) return;
      const col = [...row.cells].filter(item => !item.hasAttribute('data-tool-cell')).indexOf(cell as HTMLTableCellElement);
      if (col < 0) return;
      const tableKey = root.read(() => {
        const node = $getNearestNodeFromDOMNode(table);
        return $isTableNode(node) ? node.getKey() : undefined;
      });
      if (!tableKey) return;
      const visitors = realm.getValue(exportVisitors$);
      const settings = { jsxComponentDescriptors: realm.getValue(jsxComponentDescriptors$),
        jsxIsAvailable: realm.getValue(jsxIsAvailable$), addImportStatements: false };
      const content = nested.read(() => exportLexicalTreeToMdast({ ...settings, root: $getRoot(), visitors }))
        .children.find(child => child.type === 'paragraph');
      if (!content) return;
      // The nested editor commits to the table when leaving the cell. Overlay its
      // current AST into this export only, so a download or autosave keeps focus.
      const activeCell: LexicalVisitor = {
        priority: 50, testLexicalNode: (node): node is TableNode => $isTableNode(node) && node.getKey() === tableKey,
        visitLexicalNode({ lexicalNode, mdastParent, actions }) {
          if (!$isTableNode(lexicalNode)) return;
          const copy = structuredClone(lexicalNode.getMdastNode());
          const target = copy.children[row.sectionRowIndex]?.children[col];
          if (target) target.children = content.children;
          actions.appendToParent(mdastParent,copy);
        }
      };
      const merged = root.read(() => exportLexicalTreeToMdast({
        ...settings, root: $getRoot(), visitors: [activeCell,...visitors]
      }));
      return toMarkdown(merged,{ extensions: [gfmToMarkdown()] }).trimEnd();
    }, reference => realm.pub(insertImage$,{ src: reference, altText: 'Ảnh minh họa' }));
  }
});

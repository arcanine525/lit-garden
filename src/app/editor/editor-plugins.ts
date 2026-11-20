import {
  $isTableNode, activeEditor$, addExportVisitor$, applyFormat$, applyListType$, convertSelectionToNode$, currentFormat$,
  editorInTable$, exportLexicalTreeToMdast, exportVisitors$, insertImage$, insertTable$, jsxComponentDescriptors$,
  jsxIsAvailable$, openLinkEditDialog$, realmPlugin, rootEditor$, type LexicalVisitor, type TableNode
} from '@mdxeditor/editor';
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text';
import { $createParagraphNode, $getNearestNodeFromDOMNode, $getRoot, $isLineBreakNode, getNearestEditorFromDOMNode,
  IS_BOLD, IS_ITALIC, REDO_COMMAND, UNDO_COMMAND } from 'lexical';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';

type Snapshot = () => string | undefined;
export type WorksheetFormat = { bold: boolean; italic: boolean; inTable: boolean };
export type WorksheetActions = {
  format: (style: 'bold' | 'italic') => void;
  block: (kind: HeadingTagType | 'paragraph' | 'quote') => void;
  list: (kind: 'bullet' | 'number' | '') => void;
  table: () => void;
  link: () => void;
  undo: () => void;
  redo: () => void;
};

export const editorPlugins = realmPlugin<{
  install(snapshot: Snapshot, attach: (reference: string) => void): void;
  worksheet?: { install: (actions: WorksheetActions) => void; onFormat: (format: WorksheetFormat) => void };
}>({
  init(realm, options) {
    if (options?.worksheet) {
      const { install,onFormat } = options.worksheet;
      const readFormat = () => {
        const flags = realm.getValue(currentFormat$);
        onFormat({ bold:Boolean(flags & IS_BOLD),italic:Boolean(flags & IS_ITALIC),inTable:realm.getValue(editorInTable$) });
      };
      realm.sub(currentFormat$,readFormat);
      realm.sub(editorInTable$,readFormat);
      install({
        format:style => realm.pub(applyFormat$,style),
        block:kind => realm.pub(convertSelectionToNode$,() => {
          if (kind === 'quote') return $createQuoteNode();
          if (kind === 'paragraph') return $createParagraphNode();
          return $createHeadingNode(kind);
        }),
        list:kind => realm.pub(applyListType$,kind),
        table:() => realm.pub(insertTable$,{ rows:3,columns:3 }),
        link:() => realm.pub(openLinkEditDialog$,undefined),
        undo:() => realm.getValue(activeEditor$)?.dispatchCommand(UNDO_COMMAND,undefined),
        redo:() => realm.getValue(activeEditor$)?.dispatchCommand(REDO_COMMAND,undefined)
      });
    }
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

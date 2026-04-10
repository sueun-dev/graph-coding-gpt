import { type ChangeEvent, useMemo, useState } from "react";
import FolderOpenButton from "./FolderOpenButton";
import { SHAPE_LIBRARY } from "../lib/diagram";
import { getHarnessPreset } from "../lib/harness";
import type { EditorTab, HarnessConfig, ShapeType, WorkspaceFile, WorkspaceTreeNode } from "../lib/types";

type ExplorerPanelProps = {
  workspaceName: string;
  workspaceTree: WorkspaceTreeNode[];
  editorTabs: EditorTab[];
  activeEditor: string;
  onOpenFolder: () => void;
  onFolderImportChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectEditor: (id: string) => void;
  onSelectFile: (file: WorkspaceFile) => void;
  onAddNode: (shape: ShapeType) => void;
  onResetDiagram: () => void;
  harnessConfig: HarnessConfig | null;
  onOpenSetup: () => void;
};

type TreeItemProps = {
  node: WorkspaceTreeNode;
  depth: number;
  activeEditor: string;
  onSelectFile: (file: WorkspaceFile) => void;
};

function TreeItem({ node, depth, activeEditor, onSelectFile }: TreeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const paddingLeft = 12 + depth * 14;

  if (node.kind === "folder") {
    return (
      <div>
        <button className="tree-item tree-item-folder" style={{ paddingLeft }} onClick={() => setExpanded((open) => !open)}>
          <span className="tree-chevron">{expanded ? "▾" : "▸"}</span>
          <span className="tree-icon">📁</span>
          <span>{node.name}</span>
        </button>
        {expanded && node.children.map((child) => <TreeItem key={child.id} node={child} depth={depth + 1} activeEditor={activeEditor} onSelectFile={onSelectFile} />)}
      </div>
    );
  }

  return (
    <button
      className={`tree-item tree-item-file ${activeEditor === `file:${node.path}` ? "is-active" : ""}`}
      style={{ paddingLeft }}
      onClick={() => node.file && onSelectFile(node.file)}
    >
      <span className="tree-icon">📄</span>
      <span>{node.name}</span>
    </button>
  );
}

export default function ExplorerPanel({
  workspaceName,
  workspaceTree,
  editorTabs,
  activeEditor,
  onOpenFolder,
  onFolderImportChange,
  onSelectEditor,
  onSelectFile,
  onAddNode,
  onResetDiagram,
  harnessConfig,
  onOpenSetup,
}: ExplorerPanelProps) {
  const openEditors = useMemo(
    () => editorTabs.filter((tab) => tab.kind === "diagram" || tab.kind === "file" || tab.kind === "harness"),
    [editorTabs],
  );

  return (
    <aside className="explorer-panel">
      <div className="sidebar-section">
        <div className="sidebar-title-row">
          <span className="sidebar-heading">Explorer</span>
          <button className="icon-button" onClick={onResetDiagram} title="Reset Diagram">
            ↺
          </button>
        </div>
        <div className="sidebar-subheading">OPEN EDITORS</div>
        <div className="open-editors">
          {openEditors.map((tab) => (
            <button key={tab.id} className={`open-editor ${activeEditor === tab.id ? "is-active" : ""}`} onClick={() => onSelectEditor(tab.id)}>
              <span className="tree-icon">{tab.kind === "diagram" ? "◎" : tab.kind === "harness" ? "⚙" : "📄"}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-subheading">WORKSPACE SETUP</div>
        <div className="workspace-actions">
          <button className="primary-button compact-button" onClick={onOpenSetup}>
            {harnessConfig ? "Edit Harness" : "Create Harness"}
          </button>
        </div>
        {harnessConfig ? (
          <div className="harness-brief">
            <strong>{getHarnessPreset(harnessConfig.presetId).label}</strong>
            <span>{harnessConfig.stack.frontend}</span>
            <span>{harnessConfig.agent.sandbox}</span>
          </div>
        ) : (
          <p className="sidebar-empty">Harness를 먼저 만들면 이후 도식화와 빌드 프롬프트가 더 안정적으로 고정됩니다.</p>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-subheading">WORKSPACE</div>
        <div className="workspace-actions">
          <button className="primary-button compact-button" onClick={onOpenFolder}>
            Open Folder
          </button>
          <FolderOpenButton label="Import" variant="ghost" onChange={onFolderImportChange} />
        </div>
        <div className="workspace-root">{workspaceName}</div>
        <div className="tree-list">
          {workspaceTree.length > 0 ? (
            workspaceTree.map((node) => <TreeItem key={node.id} node={node} depth={0} activeEditor={activeEditor} onSelectFile={onSelectFile} />)
          ) : (
            <p className="sidebar-empty">폴더를 열면 VS Code처럼 파일 트리를 탐색할 수 있습니다.</p>
          )}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-subheading">DIAGRAM BLOCKS</div>
        <div className="block-list">
          {SHAPE_LIBRARY.map((shape) => (
            <button key={shape.type} className="block-item" onClick={() => onAddNode(shape.type)}>
              <span className="block-swatch" style={{ background: shape.accent }} />
              <span className="block-copy">
                <strong>{shape.label}</strong>
                <small>{shape.description}</small>
              </span>
              <span className="block-add">+</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

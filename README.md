# minver — browser-side tiddler versioning

Keep snapshot versions of your tiddlers directly in the browser. Snapshots are stored compressed in localStorage and survive page reloads.

## Key features

- **Manual snapshots** — take a snapshot anytime from the editor preview pane
- **Auto-snapshots** — automatically captures the previous version on every save
- **Auto-snapshots on create/delete** — automatically captures initial state on creation and final state on deletion
- **Diff view** — per-field comparison with `<$diff-text>`, integrated as an editor preview type
- **Field-level rollback** — revert individual fields or the entire tiddler
- **Manager revert** — revert any snapshot directly from the manager
- **Change-groups** — record a session of changes (creates, edits, deletes) and review/rollback them as a unit
- **Compressed storage** — uses native CompressionStream to minimize localStorage usage
- **Export/Import** — transfer snapshots between wikis via a single JSON tiddler

## Quick start

### Snapshots

1. Open any tiddler for editing
2. Click the eye icon in the editor toolbar and select "snapshots"
3. Click "Take snapshot" to create a manual snapshot
4. Edit the tiddler, then select your snapshot to see the diff
5. Use the undo button next to any field to revert it

### Change-groups

1. Click the record button (&#x25cf;) in the page toolbar to start recording changes
2. Make your edits (create, modify, delete tiddlers)
3. Click stop (&#x25a0;) to finish — view your change-group in the "groups" plugin tab
4. Use "Rollback" to undo all changes in the group

## Prerequisites

- TiddlyWiki 5.3.0+
- Theme plugin (`$:/plugins/rimir/theme`)
- A modern browser with CompressionStream support (Chrome 80+, Firefox 113+, Safari 16.4+)

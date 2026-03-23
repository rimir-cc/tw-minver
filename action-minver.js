/*\
title: $:/plugins/rimir/minver/action-minver.js
type: application/javascript
module-type: widget
\*/
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var ActionMinver = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

ActionMinver.prototype = new Widget();

ActionMinver.prototype.render = function(parent, nextSibling) {
	this.computeAttributes();
	this.execute();
};

ActionMinver.prototype.execute = function() {
	this.actionOp = this.getAttribute("op", "snapshot");
	this.actionTitle = this.getAttribute("title", "");
	this.actionLabel = this.getAttribute("label", "");
	this.actionSnapshotId = this.getAttribute("snapshot-id", "");
	this.actionDraft = this.getAttribute("draft", "");
	this.actionSource = this.getAttribute("source", "draft"); // "draft" or "saved"
	this.actionGroupId = this.getAttribute("group-id", "");
};

ActionMinver.prototype.refresh = function(changedTiddlers) {
	return this.refreshSelf();
};

ActionMinver.prototype.invokeAction = function(triggeringWidget, event) {
	var storage = require("$:/plugins/rimir/minver/storage.js");
	var op = this.actionOp;
	var title = this.actionTitle;
	var wiki = this.wiki;

	if (op === "snapshot") {
		// Take a manual snapshot
		var useDraft = this.actionSource === "draft";
		var fields = storage.captureTiddlerFields(wiki, title, useDraft);
		if (!fields) return true;
		var label = this.actionLabel || "snapshot-" + $tw.utils.stringifyDate(new Date());
		var snapshot = storage.createSnapshot("manual", label, fields);
		var snapshots = storage.getSnapshotsFromStore(wiki, title);
		snapshots.push(snapshot);
		snapshots = storage.evict(snapshots, storage.getMaxManual(wiki), storage.getMaxAuto(wiki));
		storage.saveSnapshotsToStore(wiki, title, snapshots);
		// Manual snapshots always go to localStorage
		storage.saveToLocalStorage(title, snapshots);

	} else if (op === "delete") {
		// Delete a specific snapshot
		var snapshotId = this.actionSnapshotId;
		if (!snapshotId || !title) return true;
		var snapshots = storage.getSnapshotsFromStore(wiki, title);
		snapshots = snapshots.filter(function(s) { return s.id !== snapshotId; });
		storage.saveSnapshotsToStore(wiki, title, snapshots);
		storage.saveToLocalStorage(title, snapshots);

	} else if (op === "delete-all") {
		// Delete all snapshots for a tiddler
		if (!title) return true;
		storage.saveSnapshotsToStore(wiki, title, []);
		storage.saveToLocalStorage(title, []);

	} else if (op === "rollback") {
		// Rollback: apply snapshot fields to the draft tiddler
		var snapshotId = this.actionSnapshotId;
		var draftTitle = this.actionDraft;
		if (!snapshotId || !draftTitle) return true;
		var snapshots = storage.getSnapshotsFromStore(wiki, title);
		var snapshot = storage.findSnapshot(snapshots, snapshotId);
		if (!snapshot) return true;
		// Apply all fields from snapshot to draft — rebuild from scratch
		// (don't merge with draft, otherwise fields added after the snapshot persist)
		var draft = wiki.getTiddler(draftTitle);
		if (!draft) return true;
		var newFields = {};
		for (var field in snapshot.fields) {
			if (Object.prototype.hasOwnProperty.call(snapshot.fields, field)) {
				if (field === "title") continue;
				newFields[field] = snapshot.fields[field];
			}
		}
		newFields.title = draftTitle;
		newFields["draft.of"] = title;
		newFields["draft.title"] = title;
		wiki.addTiddler(new $tw.Tiddler(newFields));

	} else if (op === "rollback-field") {
		// Rollback a single field from snapshot
		var snapshotId = this.actionSnapshotId;
		var draftTitle = this.actionDraft;
		var fieldName = this.getAttribute("field", "");
		if (!snapshotId || !draftTitle || !fieldName) return true;
		var snapshots = storage.getSnapshotsFromStore(wiki, title);
		var snapshot = storage.findSnapshot(snapshots, snapshotId);
		if (!snapshot) return true;
		var draft = wiki.getTiddler(draftTitle);
		if (!draft) return true;
		var val = snapshot.fields[fieldName];
		if (val !== undefined) {
			// Field exists in snapshot — set it on the draft
			var update = {};
			update[fieldName] = val;
			wiki.addTiddler(new $tw.Tiddler(draft, update));
		} else {
			// Field doesn't exist in snapshot — remove it from draft
			// Rebuild without the field (TW's Tiddler constructor ignores undefined)
			var newFields = {};
			for (var f in draft.fields) {
				if (Object.prototype.hasOwnProperty.call(draft.fields, f) && f !== fieldName) {
					newFields[f] = draft.fields[f];
				}
			}
			wiki.addTiddler(new $tw.Tiddler(newFields));
		}

	} else if (op === "revert") {
		// Revert: apply snapshot fields directly to the saved tiddler (manager context, no draft)
		var snapshotId = this.actionSnapshotId;
		if (!snapshotId || !title) return true;
		var snapshots = storage.getSnapshotsFromStore(wiki, title);
		var snapshot = storage.findSnapshot(snapshots, snapshotId);
		if (!snapshot) return true;
		var currentFields = storage.captureTiddlerFields(wiki, title, false);
		var isDeletedSnapshot = snapshot.label && snapshot.label.indexOf("deleted-") === 0;
		var isCreatedSnapshot = snapshot.label && snapshot.label.indexOf("created-") === 0;
		// Remove the reverted snapshot from the list
		snapshots = snapshots.filter(function(s) { return s.id !== snapshotId; });
		if (isDeletedSnapshot) {
			// "deleted-*" snapshot: undo deletion by recreating the tiddler
			wiki.addTiddler(new $tw.Tiddler(snapshot.fields));
			// Add a "created-*" snapshot since addTiddler bypasses th-saving-tiddler
			var createdSnapshot = storage.createSnapshot("auto", "created-" + $tw.utils.stringifyDate(new Date()), snapshot.fields);
			snapshots.push(createdSnapshot);
			storage.saveSnapshotsToStore(wiki, title, snapshots);
			storage.saveToLocalStorage(title, snapshots);
		} else if (isCreatedSnapshot) {
			// "created-*" snapshot: undo creation by deleting the tiddler
			storage.saveSnapshotsToStore(wiki, title, []);
			storage.saveToLocalStorage(title, []);
			wiki.deleteTiddler(title);
		} else {
			// Regular snapshot: take safety snapshot if state differs, then apply
			if (currentFields && !storage.fieldsEqual(currentFields, snapshot.fields)) {
				var safetySnapshot = storage.createSnapshot("auto", "pre-revert-" + $tw.utils.stringifyDate(new Date()), currentFields);
				snapshots.push(safetySnapshot);
				snapshots = storage.evict(snapshots, storage.getMaxManual(wiki), storage.getMaxAuto(wiki));
			}
			storage.saveSnapshotsToStore(wiki, title, snapshots);
			storage.saveToLocalStorage(title, snapshots);
			wiki.addTiddler(new $tw.Tiddler(snapshot.fields));
		}

	} else if (op === "clean-all") {
		// Delete ALL snapshots from localStorage and wiki store
		// Clear all $:/temp/minver/ tiddlers
		var tempTiddlers = wiki.filterTiddlers("[prefix[$:/temp/minver/]]");
		for (var j = 0; j < tempTiddlers.length; j++) {
			wiki.deleteTiddler(tempTiddlers[j]);
		}
		// Clear localStorage
		try {
			for (var k = localStorage.length - 1; k >= 0; k--) {
				var key = localStorage.key(k);
				if (key && key.indexOf(storage.STORAGE_PREFIX) === 0) {
					localStorage.removeItem(key);
				}
			}
		} catch (e) {
			console.warn("minver: failed to clear localStorage", e);
		}

	} else if (op === "export") {
		// Export all snapshots to a tiddler
		storage.loadAllFromLocalStorage().then(function(all) {
			wiki.addTiddler(new $tw.Tiddler({
				title: "$:/minver/export",
				text: JSON.stringify(all, null, 2),
				type: "application/json",
				tags: "",
				modified: new Date()
			}));
		});

	} else if (op === "import") {
		// Import snapshots from the export tiddler
		var exportTiddler = wiki.getTiddler("$:/minver/export");
		if (!exportTiddler) return true;
		try {
			var data = JSON.parse(exportTiddler.fields.text);
			var titles = Object.keys(data);
			var promises = titles.map(function(t) {
				var snapshots = data[t];
				storage.saveSnapshotsToStore(wiki, t, snapshots);
				return storage.saveToLocalStorage(t, snapshots);
			});
			Promise.all(promises).then(function() {
				console.log("minver: imported snapshots for " + titles.length + " tiddler(s)");
			});
		} catch (e) {
			console.error("minver: import failed", e);
		}

	} else if (op === "cg-start") {
		// Start change-group recording
		var cgStorage = require("$:/plugins/rimir/minver/cg-storage.js");
		cgStorage.startRecording(wiki, this.actionLabel);

	} else if (op === "cg-stop") {
		// Stop change-group recording
		var cgStorage = require("$:/plugins/rimir/minver/cg-storage.js");
		cgStorage.stopRecording(wiki);

	} else if (op === "cg-delete") {
		// Delete a specific change-group
		var cgStorage = require("$:/plugins/rimir/minver/cg-storage.js");
		var groupId = this.actionGroupId;
		if (!groupId) return true;
		cgStorage.deleteGroup(groupId).then(function() {
			return cgStorage.hydrateIndex(wiki);
		});

	} else if (op === "cg-delete-all") {
		// Delete all change-groups
		var cgStorage = require("$:/plugins/rimir/minver/cg-storage.js");
		cgStorage.deleteAllGroups().then(function() {
			wiki.addTiddler(new $tw.Tiddler({
				title: cgStorage.TEMP_INDEX,
				text: "[]",
				type: "application/json"
			}));
		});

	} else if (op === "cg-load") {
		// Load a change-group from localStorage into a temp tiddler for display
		var cgStorage = require("$:/plugins/rimir/minver/cg-storage.js");
		var groupId = this.actionGroupId;
		if (!groupId) return true;
		cgStorage.loadGroup(groupId).then(function(group) {
			if (group) {
				wiki.addTiddler(new $tw.Tiddler({
					title: "$:/temp/minver/cg-group/" + groupId,
					text: JSON.stringify(group),
					type: "application/json"
				}));
			}
		});

	} else if (op === "cg-rollback") {
		// Rollback all changes in a change-group, then delete the group
		var cgStorage = require("$:/plugins/rimir/minver/cg-storage.js");
		var groupId = this.actionGroupId;
		if (!groupId) return true;
		cgStorage.loadGroup(groupId).then(function(group) {
			if (group) {
				cgStorage.rollbackGroup(wiki, group);
				// Delete the group after rollback
				return cgStorage.deleteGroup(groupId);
			}
		}).then(function() {
			return cgStorage.hydrateIndex(wiki);
		}).then(function() {
			// Clean up loaded group temp tiddler
			wiki.deleteTiddler("$:/temp/minver/cg-group/" + groupId);
		});
	}

	// Update storage usage display after any operation that may modify localStorage
	if (op === "snapshot" || op === "delete" || op === "delete-all" || op === "clean-all" || op === "import") {
		storage.updateStorageUsage();
	}

	return true;
};

exports["action-minver"] = ActionMinver;

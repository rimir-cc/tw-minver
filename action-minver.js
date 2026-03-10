/*\
title: $:/plugins/rimir/minver/action-minver.js
type: application/javascript
module-type: widget
\*/
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

function updateStorageUsage(storage) {
	var bytes = storage.getLocalStorageUsage();
	var label;
	if (bytes < 1024) {
		label = bytes + " B";
	} else if (bytes < 1024 * 1024) {
		label = (bytes / 1024).toFixed(1) + " KB";
	} else {
		label = (bytes / (1024 * 1024)).toFixed(2) + " MB";
	}
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/temp/minver/storage-usage",
		text: label
	}));
}

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
		var snapshot = null;
		for (var i = 0; i < snapshots.length; i++) {
			if (snapshots[i].id === snapshotId) {
				snapshot = snapshots[i];
				break;
			}
		}
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
		var snapshot = null;
		for (var i = 0; i < snapshots.length; i++) {
			if (snapshots[i].id === snapshotId) {
				snapshot = snapshots[i];
				break;
			}
		}
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

	} else if (op === "clean-all") {
		// Delete ALL snapshots from localStorage and wiki store
		var keys = storage.getAllLocalStorageKeys();
		for (var i = 0; i < keys.length; i++) {
			storage.saveSnapshotsToStore(wiki, keys[i], []);
		}
		// Clear ALL $:/temp/minver/ tiddlers (snapshots, labels, status, etc.)
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
	}

	// Update storage usage display after any operation that may modify localStorage
	if (op === "snapshot" || op === "delete" || op === "delete-all" || op === "clean-all" || op === "import") {
		updateStorageUsage(storage);
	}

	return true;
};

exports["action-minver"] = ActionMinver;

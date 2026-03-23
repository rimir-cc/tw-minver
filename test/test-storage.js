/*\
title: $:/plugins/rimir/minver/test/test-storage.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for minver storage library.

\*/
"use strict";

describe("minver: storage", function() {

	var storage = require("$:/plugins/rimir/minver/storage.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	describe("evict", function() {
		function makeSnap(type, ts) {
			return {type: type, timestamp: ts, id: "id-" + ts, label: "snap-" + ts, fields: {}};
		}

		it("should keep all when under limits", function() {
			var snaps = [makeSnap("manual", 100), makeSnap("auto", 200)];
			var result = storage.evict(snaps, 5, 5);
			expect(result.length).toBe(2);
		});

		it("should evict oldest manual snapshots", function() {
			var snaps = [
				makeSnap("manual", 100),
				makeSnap("manual", 200),
				makeSnap("manual", 300)
			];
			var result = storage.evict(snaps, 2, 5);
			expect(result.length).toBe(2);
			expect(result[0].timestamp).toBe(300);
			expect(result[1].timestamp).toBe(200);
		});

		it("should evict oldest auto snapshots", function() {
			var snaps = [
				makeSnap("auto", 100),
				makeSnap("auto", 200),
				makeSnap("auto", 300),
				makeSnap("auto", 400)
			];
			var result = storage.evict(snaps, 5, 2);
			expect(result.length).toBe(2);
			expect(result[0].timestamp).toBe(400);
			expect(result[1].timestamp).toBe(300);
		});

		it("should handle mixed types independently", function() {
			var snaps = [
				makeSnap("manual", 100),
				makeSnap("manual", 200),
				makeSnap("manual", 300),
				makeSnap("auto", 400),
				makeSnap("auto", 500)
			];
			var result = storage.evict(snaps, 1, 1);
			expect(result.length).toBe(2);
			expect(result[0].type).toBe("manual");
			expect(result[0].timestamp).toBe(300);
			expect(result[1].type).toBe("auto");
			expect(result[1].timestamp).toBe(500);
		});

		it("should return empty for empty input", function() {
			expect(storage.evict([], 3, 3).length).toBe(0);
		});

		it("should not evict when max is 0 (unlimited)", function() {
			var snaps = [makeSnap("manual", 100), makeSnap("manual", 200), makeSnap("manual", 300)];
			var result = storage.evict(snaps, 0, 0);
			expect(result.length).toBe(3);
		});
	});

	describe("generateId", function() {
		it("should return a UUID-formatted string", function() {
			var id = storage.generateId();
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		});

		it("should generate unique IDs", function() {
			var a = storage.generateId();
			var b = storage.generateId();
			expect(a).not.toBe(b);
		});
	});

	describe("getTempTitle", function() {
		it("should prefix with temp path", function() {
			expect(storage.getTempTitle("MyTiddler")).toBe("$:/temp/minver/snapshots/MyTiddler");
		});

		it("should handle system tiddler titles", function() {
			expect(storage.getTempTitle("$:/config/something")).toBe("$:/temp/minver/snapshots/$:/config/something");
		});
	});

	describe("wiki store operations", function() {
		it("should save and retrieve snapshots", function() {
			var wiki = setupWiki();
			var snaps = [{id: "1", label: "test", type: "manual", timestamp: 1000, fields: {text: "hello"}}];
			storage.saveSnapshotsToStore(wiki, "TestTiddler", snaps);
			var loaded = storage.getSnapshotsFromStore(wiki, "TestTiddler");
			expect(loaded.length).toBe(1);
			expect(loaded[0].id).toBe("1");
			expect(loaded[0].fields.text).toBe("hello");
		});

		it("should return empty array for missing tiddler", function() {
			var wiki = setupWiki();
			expect(storage.getSnapshotsFromStore(wiki, "NonExistent")).toEqual([]);
		});

		it("should return empty array for invalid JSON", function() {
			var wiki = setupWiki([
				{title: "$:/temp/minver/snapshots/Bad", text: "not json", type: "application/json"}
			]);
			expect(storage.getSnapshotsFromStore(wiki, "Bad")).toEqual([]);
		});
	});

	describe("createSnapshot", function() {
		it("should create snapshot with all fields", function() {
			var fields = {text: "hello", title: "Test"};
			var snap = storage.createSnapshot("manual", "my label", fields);
			expect(snap.type).toBe("manual");
			expect(snap.label).toBe("my label");
			expect(snap.fields).toEqual(fields);
			expect(snap.id).toBeDefined();
			expect(snap.timestamp).toBeDefined();
		});

		it("should use defaults for missing type and label", function() {
			var snap = storage.createSnapshot(null, null, {});
			expect(snap.type).toBe("manual");
			expect(snap.label).toMatch(/^snapshot-/);
		});
	});

	describe("config helpers", function() {
		it("should read config from wiki", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/minver/max-manual", text: "10"}
			]);
			expect(storage.getConfig(wiki, "max-manual", "3")).toBe("10");
		});

		it("should return default when config missing", function() {
			var wiki = setupWiki();
			expect(storage.getConfig(wiki, "max-manual", "3")).toBe("3");
		});

		it("should parse max values as integers", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/minver/max-manual", text: "7"},
				{title: "$:/config/rimir/minver/max-auto", text: "5"}
			]);
			expect(storage.getMaxManual(wiki)).toBe(7);
			expect(storage.getMaxAuto(wiki)).toBe(5);
		});

		it("should default to 3 for invalid values", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/minver/max-manual", text: "not a number"}
			]);
			expect(storage.getMaxManual(wiki)).toBe(3);
		});

		it("should return default for empty string config", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/minver/max-manual", text: ""}
			]);
			expect(storage.getConfig(wiki, "max-manual", "3")).toBe("3");
		});

		it("should read scope filter", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/minver/scope-filter", text: "[!is[system]]"}
			]);
			expect(storage.getScopeFilter(wiki)).toBe("[!is[system]]");
		});

		it("should default scope filter to [all[]]", function() {
			var wiki = setupWiki();
			expect(storage.getScopeFilter(wiki)).toBe("[all[]]");
		});

		it("should read auto-to-storage setting", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/minver/auto-to-storage", text: "yes"}
			]);
			expect(storage.isAutoToStorage(wiki)).toBe(true);
		});

		it("should default auto-to-storage to false", function() {
			var wiki = setupWiki();
			expect(storage.isAutoToStorage(wiki)).toBe(false);
		});
	});

	describe("captureTiddlerFields", function() {
		it("should capture all fields as strings", function() {
			var wiki = setupWiki([
				{title: "Test", text: "hello", tags: ["a", "b"], custom: "val"}
			]);
			var fields = storage.captureTiddlerFields(wiki, "Test", false);
			expect(fields.title).toBe("Test");
			expect(fields.text).toBe("hello");
			expect(fields.custom).toBe("val");
		});

		it("should return null for missing tiddler", function() {
			var wiki = setupWiki();
			expect(storage.captureTiddlerFields(wiki, "NonExistent", false)).toBeNull();
		});

		it("should strip draft fields and use draft.of as title", function() {
			var wiki = setupWiki([
				{title: "Draft of 'Test'", text: "draft text", "draft.of": "Test", "draft.title": "Test"}
			]);
			var fields = storage.captureTiddlerFields(wiki, "Draft of 'Test'", false);
			expect(fields.title).toBe("Test");
			expect(fields["draft.of"]).toBeUndefined();
			expect(fields["draft.title"]).toBeUndefined();
		});

		it("should convert arrays to string lists", function() {
			var wiki = setupWiki([
				{title: "Test", text: "hello", tags: ["alpha", "beta gamma"]}
			]);
			var fields = storage.captureTiddlerFields(wiki, "Test", false);
			// TW stringifyList puts double-brackets around items with spaces
			expect(fields.tags).toContain("alpha");
			expect(fields.tags).toContain("beta gamma");
		});

		it("should stringify all field values as strings", function() {
			var wiki = setupWiki([
				{title: "Test", text: "hello", custom: 42}
			]);
			var fields = storage.captureTiddlerFields(wiki, "Test", false);
			// Even numeric values should be converted to strings
			expect(typeof fields.title).toBe("string");
			expect(typeof fields.text).toBe("string");
		});
	});

	describe("fieldsEqual", function() {
		it("should return true for identical objects", function() {
			var a = {title: "Test", text: "hello"};
			var b = {title: "Test", text: "hello"};
			expect(storage.fieldsEqual(a, b)).toBe(true);
		});

		it("should return false for different values", function() {
			var a = {title: "Test", text: "hello"};
			var b = {title: "Test", text: "world"};
			expect(storage.fieldsEqual(a, b)).toBe(false);
		});

		it("should return false for different key counts", function() {
			var a = {title: "Test"};
			var b = {title: "Test", text: "hello"};
			expect(storage.fieldsEqual(a, b)).toBe(false);
		});

		it("should return true for same reference", function() {
			var a = {title: "Test"};
			expect(storage.fieldsEqual(a, a)).toBe(true);
		});

		it("should return false when first arg is null", function() {
			expect(storage.fieldsEqual(null, {title: "Test"})).toBe(false);
		});

		it("should return false when second arg is null", function() {
			expect(storage.fieldsEqual({title: "Test"}, null)).toBe(false);
		});

		it("should return true for two empty objects", function() {
			expect(storage.fieldsEqual({}, {})).toBe(true);
		});

		it("should return false when key exists in a but not b", function() {
			var a = {title: "Test", extra: "val"};
			var b = {title: "Test", other: "val"};
			expect(storage.fieldsEqual(a, b)).toBe(false);
		});
	});

	describe("findSnapshot", function() {
		var snaps = [
			{id: "aaa", label: "first"},
			{id: "bbb", label: "second"},
			{id: "ccc", label: "third"}
		];

		it("should find snapshot by id", function() {
			var result = storage.findSnapshot(snaps, "bbb");
			expect(result).not.toBeNull();
			expect(result.label).toBe("second");
		});

		it("should return null for unknown id", function() {
			expect(storage.findSnapshot(snaps, "zzz")).toBeNull();
		});

		it("should return null for empty array", function() {
			expect(storage.findSnapshot([], "aaa")).toBeNull();
		});

		it("should return first match", function() {
			var result = storage.findSnapshot(snaps, "aaa");
			expect(result.label).toBe("first");
		});
	});

	describe("serializeTiddlerFields", function() {
		it("should convert string values as-is", function() {
			var result = storage.serializeTiddlerFields({title: "Test", text: "hello"});
			expect(result.title).toBe("Test");
			expect(result.text).toBe("hello");
		});

		it("should convert Date fields to strings", function() {
			// Note: `instanceof Date` fails across TW's Node.js module sandbox
			// boundaries (Date constructor differs between contexts). In the
			// browser this works correctly and produces TW date strings.
			// In Node tests, Dates fall through to String(val).
			// We verify that the output is always a string regardless.
			var wiki = new $tw.Wiki();
			var now = new Date();
			wiki.addTiddler(new $tw.Tiddler({title: "DateTest", text: "hello", created: now}));
			var fields = storage.captureTiddlerFields(wiki, "DateTest", false);
			expect(typeof fields.created).toBe("string");
			expect(fields.created.length).toBeGreaterThan(0);
		});

		it("should convert Array via stringifyList", function() {
			var result = storage.serializeTiddlerFields({tags: ["alpha", "beta"]});
			expect(result.tags).toBe($tw.utils.stringifyList(["alpha", "beta"]));
		});

		it("should convert numbers to strings", function() {
			var result = storage.serializeTiddlerFields({count: 42});
			expect(result.count).toBe("42");
		});

		it("should handle empty object", function() {
			var result = storage.serializeTiddlerFields({});
			expect(Object.keys(result).length).toBe(0);
		});

		it("should not include inherited properties", function() {
			var proto = {inherited: "val"};
			var obj = Object.create(proto);
			obj.own = "mine";
			var result = storage.serializeTiddlerFields(obj);
			expect(result.own).toBe("mine");
			expect(result.inherited).toBeUndefined();
		});
	});

	describe("saveSnapshotsToStore with empty array", function() {
		it("should delete the temp tiddler when given empty array", function() {
			var wiki = setupWiki();
			// First save some snapshots
			storage.saveSnapshotsToStore(wiki, "TestTiddler", [{id: "1", label: "test"}]);
			var tempTitle = storage.getTempTitle("TestTiddler");
			expect(wiki.tiddlerExists(tempTitle)).toBe(true);
			// Now save empty array — should delete
			storage.saveSnapshotsToStore(wiki, "TestTiddler", []);
			expect(wiki.tiddlerExists(tempTitle)).toBe(false);
		});

		it("should delete the temp tiddler when given null", function() {
			var wiki = setupWiki();
			storage.saveSnapshotsToStore(wiki, "TestTiddler", [{id: "1", label: "test"}]);
			var tempTitle = storage.getTempTitle("TestTiddler");
			expect(wiki.tiddlerExists(tempTitle)).toBe(true);
			storage.saveSnapshotsToStore(wiki, "TestTiddler", null);
			expect(wiki.tiddlerExists(tempTitle)).toBe(false);
		});
	});

	describe("constants", function() {
		it("should export TEMP_PREFIX", function() {
			expect(storage.TEMP_PREFIX).toBe("$:/temp/minver/snapshots/");
		});

		it("should export STORAGE_PREFIX", function() {
			expect(storage.STORAGE_PREFIX).toBe("minver:");
		});
	});
});

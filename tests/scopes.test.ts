import { expect } from "chai"
import { ScopeV2, ScopeV1, Scope, ScopeList } from "../scope"

describe("Scopes", () => {

    describe("ScopeV1", () => {
        it ('parses "patient/*.*"', () => {
            const scope = new ScopeV1("patient/*.*");
            expect(scope).to.have.property("level", "patient")
            expect(scope).to.have.property("resource", "*")
            expect(scope.actions.get("create")).to.deep.equal(true)
            expect(scope.actions.get("read"  )).to.deep.equal(true)
            expect(scope.actions.get("update")).to.deep.equal(true)
            expect(scope.actions.get("delete")).to.deep.equal(true)
            expect(scope.actions.get("search")).to.deep.equal(true)
            expect(scope.toString()).to.equal("patient/*.*")
        })

        it ('parses "user/*.write"', () => {
            const scope = new ScopeV1("user/*.write");
            expect(scope).to.have.property("level", "user")
            expect(scope).to.have.property("resource", "*")
            expect(scope.actions.get("create")).to.deep.equal(true)
            expect(scope.actions.get("read"  )).to.deep.equal(false)
            expect(scope.actions.get("update")).to.deep.equal(true)
            expect(scope.actions.get("delete")).to.deep.equal(true)
            expect(scope.actions.get("search")).to.deep.equal(false)
            expect(scope.toString()).to.equal("user/*.write")
        })

        it ('parses "system/Observation.read"', () => {
            const scope = new ScopeV1("system/Observation.read");
            expect(scope).to.have.property("level", "system")
            expect(scope).to.have.property("resource", "Observation")
            expect(scope.actions.get("create")).to.deep.equal(false)
            expect(scope.actions.get("read"  )).to.deep.equal(true)
            expect(scope.actions.get("update")).to.deep.equal(false)
            expect(scope.actions.get("delete")).to.deep.equal(false)
            expect(scope.actions.get("search")).to.deep.equal(true)
            expect(scope.toString()).to.equal("system/Observation.read")
        })
    });

    describe("ScopeV2", () => {
        it ('parses "patient/*.cruds"', () => {
            const scope = new ScopeV2("patient/*.cruds");
            expect(scope).to.have.property("level", "patient")
            expect(scope).to.have.property("resource", "*")
            expect(scope.query).to.be.an.instanceOf(URLSearchParams)
            expect(scope.actions.get("create")).to.deep.equal(true)
            expect(scope.actions.get("read")).to.deep.equal(true)
            expect(scope.actions.get("update")).to.deep.equal(true)
            expect(scope.actions.get("delete")).to.deep.equal(true)
            expect(scope.actions.get("search")).to.deep.equal(true)
            expect(scope.toString()).to.equal("patient/*.cruds")
        })

        it ('parses "user/Observation.rs"', () => {
            const scope = new ScopeV2("user/Observation.rs");
            expect(scope).to.have.property("level", "user")
            expect(scope).to.have.property("resource", "Observation")
            expect(scope.query).to.be.an.instanceOf(URLSearchParams)
            expect(scope.actions.get("create")).to.deep.equal(false)
            expect(scope.actions.get("read")).to.deep.equal(true)
            expect(scope.actions.get("update")).to.deep.equal(false)
            expect(scope.actions.get("delete")).to.deep.equal(false)
            expect(scope.actions.get("search")).to.deep.equal(true)
            expect(scope.toString()).to.equal("user/Observation.rs")
        })

        it ('parses "system/Observation.rsd?a=b&c=d"', () => {
            const scope = new ScopeV2("system/Observation.rsd?a=b&c=d");
            expect(scope).to.have.property("level", "system")
            expect(scope).to.have.property("resource", "Observation")
            expect(scope.query).to.be.an.instanceOf(URLSearchParams)
            expect(scope.actions.get("create")).to.deep.equal(false)
            expect(scope.actions.get("read")).to.deep.equal(true)
            expect(scope.actions.get("update")).to.deep.equal(false)
            expect(scope.actions.get("delete")).to.deep.equal(true)
            expect(scope.actions.get("search")).to.deep.equal(true)
            expect(scope.query.get("a")).to.equal("b")
            expect(scope.query.get("c")).to.equal("d")
            expect(scope.toString()).to.equal("system/Observation.rsd?a=b&c=d")
        })
    })

    describe("Scope", () => {
        it ('parses v2 scopes', () => {
            const scope = Scope.fromString("system/Observation.rsd?a=b&c=d") as ScopeV2;
            expect(scope.version).to.equal("2")
            expect(scope).to.have.property("level", "system")
            expect(scope).to.have.property("resource", "Observation")
            expect(scope.query).to.be.an.instanceOf(URLSearchParams)
            expect(scope.actions.get("create")).to.deep.equal(false)
            expect(scope.actions.get("read")).to.deep.equal(true)
            expect(scope.actions.get("update")).to.deep.equal(false)
            expect(scope.actions.get("delete")).to.deep.equal(true)
            expect(scope.actions.get("search")).to.deep.equal(true)
            expect(scope.query.get("a")).to.equal("b")
            expect(scope.query.get("c")).to.equal("d")
            expect(scope.toString()).to.equal("system/Observation.rsd?a=b&c=d")
        })

        it ('parses v1 scopes', () => {
            const scope = Scope.fromString("system/Observation.read");
            expect(scope.version).to.equal("1")
            expect(scope).to.have.property("level", "system")
            expect(scope).to.have.property("resource", "Observation")
            expect(scope.actions.get("create")).to.deep.equal(false)
            expect(scope.actions.get("read"  )).to.deep.equal(true)
            expect(scope.actions.get("update")).to.deep.equal(false)
            expect(scope.actions.get("delete")).to.deep.equal(false)
            expect(scope.actions.get("search")).to.deep.equal(true)
            expect(scope.toString()).to.equal("system/Observation.read")
        })
    })

    describe("ScopeList", () => {
        it ("parses comma-separated list", () => {
            const list = ScopeList.fromString("user/*.*,system/*.rs");
            expect(list.scopes.length).to.equal(2)
        })

        it ("parses space-separated list", () => {
            const list = ScopeList.fromString("user/*.* system/*.rs");
            expect(list.scopes.length).to.equal(2)
        })

        it ("parses mixed list", () => {
            const list = ScopeList.fromString(" user/*.* ,  system/*.rs ");
            expect(list.scopes.length).to.equal(2)
        })

        it ("validateForExport rejects empty scope", async () => {
            const list = ScopeList.fromString("");
            expect(await list.validateForExport()).to.equal("Empty scope")
        })

        it ("validateForExport rejects non-system scopes", async () => {
            const list1 = ScopeList.fromString("user/Patient.read");
            expect(await list1.validateForExport()).to.equal('Only system-level scopes are allowed for bulk data export (bad scope: "user/Patient.read")');
            const list2 = ScopeList.fromString("patient/Observation.rs");
            expect(await list2.validateForExport()).to.equal('Only system-level scopes are allowed for bulk data export (bad scope: "patient/Observation.rs")');
        })

        it ("validateForExport reject if any of the scopes requires update, delete or create access", async () => {
            const list1 = ScopeList.fromString("system/Observation.write");
            expect(await list1.validateForExport()).to.equal('Cannot grant permissions to create resources requested by scope "system/Observation.write"');
            const list2 = ScopeList.fromString("system/Observation.c");
            expect(await list2.validateForExport()).to.equal('Cannot grant permissions to create resources requested by scope "system/Observation.c"');
            const list3 = ScopeList.fromString("system/Observation.u");
            expect(await list3.validateForExport()).to.equal('Cannot grant permissions to update resources requested by scope "system/Observation.u"');
            const list4 = ScopeList.fromString("system/Observation.d");
            expect(await list4.validateForExport()).to.equal('Cannot grant permissions to delete resources requested by scope "system/Observation.d"');
        })

        it ("validateForExport reject if an unknown resource is requested", async () => {
            const list1 = ScopeList.fromString("system/MissingResource.read");
            expect(await list1.validateForExport()).to.equal('Resources of type "MissingResource" do not exist on this server (requested by scope "system/MissingResource.read")');
            const list2 = ScopeList.fromString("system/MissingResource.rs");
            expect(await list2.validateForExport()).to.equal('Resources of type "MissingResource" do not exist on this server (requested by scope "system/MissingResource.rs")');
        })

        it ("negotiateForExport", async () => {
            
            expect((await ScopeList.fromString(
                "system/MissingResource.read user/Patient.rs system/Observation.cruds system/Encounter.*"
                ).negotiateForExport()).join(" ")
            ).to.equal("system/Observation.rs system/Encounter.read")
            
            expect((await ScopeList.fromString("system/*.read").negotiateForExport()).join(" ")).to.equal("system/*.read")
            
            expect(await ScopeList.fromString("").negotiateForExport()).to.deep.equal([])
        })
    })
})

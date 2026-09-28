/**
 * Presence documents, both ways (ADR 0007, D4): what real servers send
 * must fold into the seven states, what we publish must read back the
 * same, and nothing — not even garbage — may throw.
 */

import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import {
  readPidf,
  UNKNOWN,
  writePidf,
  type PublishedPresence,
  type XmlParser,
} from "../src/sip/pidf.js";

// xmldom throws on fatal errors and only warns on the rest; silence the
// warnings so the "garbage" cases do not litter the test output.
const parser = new DOMParser({ onError: () => {} }) as unknown as XmlParser;

const read = (body: string) => readPidf(body, parser);

/** Kamailio `presence` module, two devices of one user aggregated. */
const KAMAILIO_TWO_DEVICES = `<?xml version="1.0"?>
<presence xmlns="urn:ietf:params:xml:ns:pidf" xmlns:dm="urn:ietf:params:xml:ns:pidf:data-model"
    xmlns:rpid="urn:ietf:params:xml:ns:pidf:rpid" entity="sip:bob@example.com">
  <tuple id="t-desk">
    <status><basic>open</basic></status>
    <timestamp>2026-09-27T09:00:00Z</timestamp>
  </tuple>
  <dm:person id="p-desk">
    <rpid:activities><rpid:on-the-phone/></rpid:activities>
  </dm:person>
  <tuple id="t-browser">
    <status><basic>open</basic></status>
    <note>Back at 2pm</note>
    <timestamp>2026-09-27T09:12:00Z</timestamp>
  </tuple>
</presence>`;

/** Asterisk (res_pjsip_pidf_body_generator), extension in use. */
const ASTERISK_IN_USE = `<?xml version="1.0" encoding="UTF-8"?>
<presence entity="sip:1000@pbx.example.com" xmlns="urn:ietf:params:xml:ns:pidf"
    xmlns:dm="urn:ietf:params:xml:ns:pidf:data-model" xmlns:rpid="urn:ietf:params:xml:ns:pidf:rpid">
 <note>On the phone</note>
 <tuple id="1000">
  <status>
   <basic>open</basic>
  </status>
  <contact priority="1">sip:1000@pbx.example.com</contact>
 </tuple>
 <dm:person>
  <rpid:activities>
   <rpid:on-the-phone />
  </rpid:activities>
 </dm:person>
</presence>`;

/** Asterisk, extension unregistered. */
const ASTERISK_UNAVAILABLE = `<?xml version="1.0" encoding="UTF-8"?>
<presence entity="sip:1001@pbx.example.com" xmlns="urn:ietf:params:xml:ns:pidf"
    xmlns:dm="urn:ietf:params:xml:ns:pidf:data-model" xmlns:rpid="urn:ietf:params:xml:ns:pidf:rpid">
 <note>Unavailable</note>
 <tuple id="1001">
  <status><basic>closed</basic></status>
  <contact priority="1">sip:1001@pbx.example.com</contact>
 </tuple>
 <dm:person />
</presence>`;

function doc(inner: string): string {
  return `<?xml version="1.0"?>
<presence xmlns="urn:ietf:params:xml:ns:pidf" xmlns:dm="urn:ietf:params:xml:ns:pidf:data-model"
    xmlns:rpid="urn:ietf:params:xml:ns:pidf:rpid" entity="sip:carol@example.com">${inner}</presence>`;
}

const OPEN = `<tuple id="a"><status><basic>open</basic></status></tuple>`;

describe("readPidf — real bodies", () => {
  it("Kamailio: the device on the phone outweighs the one that is free", () => {
    expect(read(KAMAILIO_TWO_DEVICES)).toEqual({
      state: "on-the-phone",
      note: "Back at 2pm",
      since: Date.parse("2026-09-27T09:12:00Z"),
    });
  });

  it("Asterisk: an extension in use is on the phone", () => {
    expect(read(ASTERISK_IN_USE)).toEqual({ state: "on-the-phone", note: "On the phone", since: null });
  });

  it("Asterisk: an unregistered extension is offline", () => {
    expect(read(ASTERISK_UNAVAILABLE).state).toBe("offline");
  });
});

describe("readPidf — states", () => {
  it("open with no activity is available", () => {
    expect(read(doc(OPEN)).state).toBe("available");
  });

  it("an active subscription with no tuple is offline", () => {
    expect(read(doc("")).state).toBe("offline");
  });

  it("a closed tuple ignores the activities left behind", () => {
    const body = doc(
      `<tuple id="a"><status><basic>closed</basic></status></tuple>
       <dm:person><rpid:activities><rpid:busy/></rpid:activities></dm:person>`,
    );
    expect(read(body).state).toBe("offline");
  });

  it("one open tuple among closed ones is enough", () => {
    const body = doc(`<tuple id="a"><status><basic>closed</basic></status></tuple>${OPEN}`);
    expect(read(body).state).toBe("available");
  });

  it.each([
    ["busy", "busy"],
    ["meeting", "busy"],
    ["away", "away"],
    ["vacation", "away"],
    ["working", "available"],
  ])("activity %s reads as %s", (activity, state) => {
    const body = doc(`${OPEN}<dm:person><rpid:activities><rpid:${activity}/></rpid:activities></dm:person>`);
    expect(read(body).state).toBe(state);
  });

  it("the most constraining activity wins: dnd > busy > away", () => {
    const body = doc(
      `${OPEN}
       <dm:person id="1"><rpid:activities><rpid:away/></rpid:activities></dm:person>
       <dm:person id="2" xmlns:trix="urn:trix:params:xml:ns:pidf">
         <rpid:activities><rpid:busy/><trix:dnd/></rpid:activities>
       </dm:person>`,
    );
    expect(read(body).state).toBe("dnd");
  });

  it("dnd is only ours when it carries our namespace", () => {
    const body = doc(
      `${OPEN}<dm:person xmlns:x="urn:example:other">
         <rpid:activities><rpid:busy/><x:dnd/></rpid:activities></dm:person>`,
    );
    expect(read(body).state).toBe("busy");
  });

  it("the legacy `<activity>` text form and any prefix are understood", () => {
    const body = doc(
      `${OPEN}<pp:person xmlns:pp="urn:ietf:params:xml:ns:pidf:person"
         xmlns:es="urn:ietf:params:xml:ns:pidf:rpid:status:rpid-status">
         <status><es:activities><es:activity>on-the-phone</es:activity></es:activities></status>
       </pp:person>`,
    );
    expect(read(body).state).toBe("on-the-phone");
  });
});

describe("readPidf — note and time", () => {
  it("takes the data-model note when there is no other", () => {
    const body = doc(`${OPEN}<dm:person><dm:note> In Lyon </dm:note></dm:person>`);
    expect(read(body).note).toBe("In Lyon");
  });

  it("an empty note is no note", () => {
    expect(read(doc(`<note>  </note>${OPEN}`)).note).toBeNull();
  });

  it("activities@from counts as a timestamp", () => {
    const body = doc(
      `${OPEN}<dm:person><rpid:activities from="2026-09-27T08:00:00Z"><rpid:away/></rpid:activities></dm:person>`,
    );
    expect(read(body).since).toBe(Date.parse("2026-09-27T08:00:00Z"));
  });

  it("an unreadable timestamp is ignored", () => {
    expect(read(doc(`<tuple id="a"><status><basic>open</basic></status><timestamp>soon</timestamp></tuple>`)).since)
      .toBeNull();
  });
});

describe("readPidf — never throws", () => {
  it.each([
    ["empty body", ""],
    ["not XML", "open"],
    ["truncated", `<presence xmlns="urn:ietf:params:xml:ns:pidf"><tuple`],
    ["not PIDF", `<?xml version="1.0"?><html><body/></html>`],
    ["presence in the wrong namespace", `<presence xmlns="urn:example"><tuple/></presence>`],
  ])("%s → unknown", (_, body) => {
    expect(read(body)).toEqual(UNKNOWN);
  });

  it("a parser that throws → unknown", () => {
    const throwing: XmlParser = {
      parseFromString() {
        throw new Error("boom");
      },
    };
    expect(readPidf(OPEN, throwing)).toEqual(UNKNOWN);
  });
});

describe("writePidf", () => {
  const since = Date.parse("2026-09-27T10:00:00Z");

  it.each<PublishedPresence>(["available", "busy", "on-the-phone", "away", "dnd", "offline"])(
    "%s reads back as itself",
    (state) => {
      const body = writePidf("sip:alice@example.com", { state, note: "Hi", since }, "dev1");
      expect(read(body)).toEqual({ state, note: "Hi", since });
    },
  );

  it("dnd looks busy to a client that ignores our namespace", () => {
    const body = writePidf("sip:alice@example.com", { state: "dnd", note: null, since: null }, "dev1");
    expect(body).toContain("<rpid:busy/><trix:dnd/>");
  });

  it("offline (and Invisible) is a closed tuple with no person", () => {
    const body = writePidf("sip:alice@example.com", { state: "offline", note: null, since: null }, "dev1");
    expect(body).toContain("<basic>closed</basic>");
    expect(body).not.toContain("person");
  });

  it("escapes the note and the entity", () => {
    const note = `<b>"Tom & Jerry"</b>`;
    const body = writePidf(`sip:a&b@example.com`, { state: "available", note, since: null }, "dev1");
    expect(read(body).note).toBe(note);
    expect(body).toContain(`entity="sip:a&amp;b@example.com"`);
  });

  it("a blank note is left out", () => {
    const body = writePidf("sip:alice@example.com", { state: "available", note: "  ", since: null }, "dev1");
    expect(body).not.toContain("<note>");
  });
});

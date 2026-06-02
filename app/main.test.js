const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { Packer } = require("docx");
const core = require("./main");

const SAMPLE_RESUME = {
  candidateName: "Jane Doe",
  phone: "555-1234",
  email: "jane@example.com",
  location: "New York, NY",
  education: [
    { schoolName: "MIT", schoolLocation: "Cambridge, MA", degree: "BS Computer Science", dates: "2018 – 2022", bullets: ["GPA: 4.0"] }
  ],
  experience: [
    { companyName: "Acme Corp", roleTitle: "Software Engineer", location: "New York, NY", dates: "2022 – 2024", bullets: ["Built a thing that mattered"] }
  ],
  leadership: [
    { organizationName: "Coding Club", role: "President", location: "Campus", dates: "2020 – 2022", bullets: ["Led a team of ten"] }
  ],
  skills: "JavaScript, Python, SQL",
  interests: "Chess, hiking"
};

async function roundTripProfile(profile) {
  const doc = core.buildResumeDocxFromValues(SAMPLE_RESUME, profile);
  const buffer = await Packer.toBuffer(doc);
  const tmpPath = path.join(os.tmpdir(), `resume-roundtrip-${process.pid}-${profile.bodyFont}.docx`);
  await fs.writeFile(tmpPath, buffer);
  try {
    return await core.extractDocxStyleProfile(tmpPath, "template");
  } finally {
    await fs.rm(tmpPath, { force: true });
  }
}

test("getDefaultStyleProfile has the expected baseline shape", () => {
  const p = core.getDefaultStyleProfile();
  assert.equal(p.source, "default");
  assert.equal(p.bodyFont, "Times New Roman");
  assert.equal(p.bodySize, 20);
  assert.deepEqual(p.sectionOrder, ["education", "experience", "leadership", "skills"]);
  assert.equal(p.margins.left, 720);
});

test("extractDocxStyleProfile reads the default ATS template's fonts and margins", async () => {
  const p = await core.extractDocxStyleProfile(core.defaultDocxTemplatePath, "template");
  assert.equal(p.source, "template");
  assert.equal(p.bodyFont, "Times New Roman");
  assert.equal(p.bodySize, 20);
  assert.equal(p.margins.left, 720);
  // Whether or not headings are detected, all four sections must be representable.
  for (const key of ["education", "experience", "leadership", "skills"]) {
    assert.ok(p.sectionOrder.includes(key), `sectionOrder should include ${key}`);
  }
});

test("a custom style profile survives a build → extract round trip", async () => {
  const custom = {
    ...core.getDefaultStyleProfile(),
    source: "original",
    bodyFont: "Arial",
    bodySize: 22,
    entryTitleSize: 24,
    headingFont: "Arial",
    headingSize: 24,
    headingBorder: false,
    nameFont: "Arial",
    nameSize: 30,
    nameCaps: false,
    nameCharSpacing: 0,
    bulletChar: "-",
    margins: { top: 1000, right: 1000, bottom: 1000, left: 1000 }
  };

  const result = await roundTripProfile(custom);

  assert.equal(result.bodyFont, "Arial", "body font should be preserved");
  assert.equal(result.bodySize, 22, "body size should be preserved");
  assert.equal(result.margins.left, 1000, "left margin should be preserved");
  assert.equal(result.margins.top, 1000, "top margin should be preserved");
  assert.equal(result.nameCaps, false, "name casing should be preserved (Jane Doe is not all-caps)");
  // Section headings ("EDUCATION", etc.) are emitted as all-caps text, so order is recoverable.
  assert.deepEqual(result.sectionOrder, ["education", "experience", "leadership", "skills"]);
});

async function writeProfiledDocx(targetPath, profile) {
  const doc = core.buildResumeDocxFromValues(SAMPLE_RESUME, profile);
  await fs.writeFile(targetPath, await Packer.toBuffer(doc));
}

test("resolveResumeStyleProfile follows the template > original > default precedence", async () => {
  await core.ensureProjectDirs();
  const originalPath = path.join(core.originalResumeDir, "__test-original.docx");
  const templatePath = path.join(core.templateDir, "__test-template.docx");

  try {
    // Default: build-from-scratch with no template and no original.
    let p = await core.resolveResumeStyleProfile(core.workflowModes.buildFromScratch);
    assert.equal(p.source, "default");

    // Improve mode with an original resume present → preserve original format.
    await writeProfiledDocx(originalPath, { ...core.getDefaultStyleProfile(), bodyFont: "Georgia", bodySize: 24 });
    p = await core.resolveResumeStyleProfile(core.workflowModes.improveExistingResume);
    assert.equal(p.source, "original", "original resume should be preserved in improve mode");
    assert.equal(p.bodyFont, "Georgia");

    // Build-from-scratch ignores the original resume (per situation 1).
    p = await core.resolveResumeStyleProfile(core.workflowModes.buildFromScratch);
    assert.equal(p.source, "default", "build-from-scratch should not adopt the original resume format");

    // An uploaded template always wins, in either mode.
    await writeProfiledDocx(templatePath, { ...core.getDefaultStyleProfile(), bodyFont: "Verdana", bodySize: 18 });
    p = await core.resolveResumeStyleProfile(core.workflowModes.improveExistingResume);
    assert.equal(p.source, "template", "uploaded template should win over the original resume");
    assert.equal(p.bodyFont, "Verdana");

    p = await core.resolveResumeStyleProfile(core.workflowModes.buildFromScratch);
    assert.equal(p.source, "template", "uploaded template should be used when building from scratch");
  } finally {
    await fs.rm(originalPath, { force: true });
    await fs.rm(templatePath, { force: true });
  }
});

test("parseResumeDocx extracts structured sections, entries, and bullets", async () => {
  const parsed = await core.parseResumeDocx(path.join(__dirname, "..", "test", "original-resume", "alex-carter-resume.docx"));
  assert.ok(parsed, "parser should return a structured object");
  assert.equal(parsed.name, "ALEX CARTER");
  assert.match(parsed.contact, /alex\.carter@berkeley\.edu/);

  const titles = parsed.sections.map((s) => s.title);
  assert.deepEqual(titles, ["EDUCATION", "EXPERIENCE", "SKILLS"]);

  const edu = parsed.sections.find((s) => s.title === "EDUCATION");
  assert.equal(edu.entries[0].org, "University of California, Berkeley");
  assert.equal(edu.entries[0].dates, "Expected May 2026");
  assert.match(edu.entries[0].subtitle, /Computer Science/);
  assert.equal(edu.entries[0].bullets.length, 2);

  const exp = parsed.sections.find((s) => s.title === "EXPERIENCE");
  assert.equal(exp.entries.length, 2);
  assert.equal(exp.entries[0].org, "Campus Tech Collective");
  assert.equal(exp.entries[0].dates, "2024");

  const skills = parsed.sections.find((s) => s.title === "SKILLS");
  assert.equal(skills.entries.length, 0);
  assert.match(skills.text, /Java, Python/);
});

test("parseResumeDocx handles a template with a Projects section", async () => {
  const parsed = await core.parseResumeDocx(path.join(__dirname, "..", "test", "template", "modern-template.docx"));
  assert.ok(parsed);
  const titles = parsed.sections.map((s) => s.title);
  assert.deepEqual(titles, ["Education", "Experience", "Projects", "Skills"]);
  const projects = parsed.sections.find((s) => s.title === "Projects");
  assert.equal(projects.entries[0].org, "Project Name");
  assert.equal(projects.entries[0].dates, "Year");
});

test("custom section ordering is honored by the builder", async () => {
  const reordered = {
    ...core.getDefaultStyleProfile(),
    sectionOrder: ["experience", "education", "skills", "leadership"]
  };
  const result = await roundTripProfile(reordered);
  // experience heading should appear before education in the rebuilt document
  assert.ok(
    result.sectionOrder.indexOf("experience") < result.sectionOrder.indexOf("education"),
    "experience should precede education when the profile says so"
  );
});

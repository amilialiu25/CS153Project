/*
 * Generates the mock DOCX fixtures used for end-to-end testing of resume
 * format preservation. Run from the repo root:
 *
 *     node test/generate-mock-files.js
 *
 * Produces two deliberately DIFFERENT-looking resumes so that the resolved
 * "style profile" is easy to tell apart in the generated output:
 *
 *   test/original-resume/alex-carter-resume.docx   (classic serif: Cambria,
 *       all-caps bordered headings, 0.75in margins, "•" bullets)
 *   test/template/modern-template.docx              (modern sans: Arial,
 *       Title-Case borderless headings, 0.5in margins, "▪" bullets)
 *
 * These are authored independently of app/main.js so they behave like real
 * third-party documents, not round-trips of our own builder.
 */
const fs = require("fs");
const path = require("path");
const {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  LineRuleType,
  PageOrientation,
  Packer,
  Paragraph,
  TabStopType,
  TextRun
} = require("docx");

const PAGE_WIDTH = 12240;

function build({ font, name, nameCaps, nameSize, contact, headingSize, headingBorder, headingColor, headingCaps, margins, bulletGlyph, bodySize, sections }) {
  const contentWidth = PAGE_WIDTH - margins.left - margins.right;
  const children = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20, line: 240, lineRule: LineRuleType.AUTO },
      children: [new TextRun({ text: nameCaps ? name.toUpperCase() : name, bold: true, size: nameSize, font })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80, line: 240, lineRule: LineRuleType.AUTO },
      children: [new TextRun({ text: contact, size: bodySize, font })]
    })
  );

  for (const section of sections) {
    children.push(new Paragraph({
      spacing: { before: 120, after: 20, line: 240, lineRule: LineRuleType.AUTO },
      border: headingBorder ? { bottom: { color: "111111", space: 1, style: BorderStyle.SINGLE, size: 6 } } : undefined,
      children: [new TextRun({
        text: headingCaps ? section.title.toUpperCase() : section.title,
        bold: true,
        size: headingSize,
        font,
        color: headingColor
      })]
    }));

    for (const entry of section.entries) {
      if (entry.org) {
        children.push(new Paragraph({
          spacing: { before: 40, after: 0, line: 240, lineRule: LineRuleType.AUTO },
          tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }],
          children: [
            new TextRun({ text: entry.org, bold: true, size: headingSize - 2, font }),
            ...(entry.dates ? [new TextRun({ text: `\t${entry.dates}`, size: headingSize - 2, font })] : [])
          ]
        }));
      }
      if (entry.subtitle) {
        children.push(new Paragraph({
          spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
          children: [new TextRun({ text: entry.subtitle, italics: true, size: bodySize, font })]
        }));
      }
      for (const bullet of (entry.bullets || [])) {
        children.push(new Paragraph({
          numbering: { reference: "mock-bullets", level: 0 },
          spacing: { after: 20, line: 240, lineRule: LineRuleType.AUTO },
          children: [new TextRun({ text: bullet, size: bodySize, font })]
        }));
      }
      for (const line of (entry.lines || [])) {
        children.push(new Paragraph({
          spacing: { after: 20, line: 240, lineRule: LineRuleType.AUTO },
          children: [new TextRun({ text: line, size: bodySize, font })]
        }));
      }
    }
  }

  return new Document({
    numbering: {
      config: [{
        reference: "mock-bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: bulletGlyph,
          style: { paragraph: { indent: { left: 360, hanging: 180 } }, run: { font, size: bodySize } }
        }]
      }]
    },
    styles: {
      default: {
        document: {
          run: { font, size: bodySize },
          paragraph: { spacing: { after: 20, line: 240, lineRule: LineRuleType.AUTO } }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: 15840, orientation: PageOrientation.PORTRAIT },
          margin: { ...margins, header: 0, footer: 0, gutter: 0 }
        }
      },
      children
    }]
  });
}

// --- Original resume: Alex Carter, classic serif look -----------------------
const originalResume = build({
  font: "Cambria",
  name: "Alex Carter",
  nameCaps: true,
  nameSize: 30,
  contact: "Berkeley, CA | alex.carter@berkeley.edu | (510) 555-0188 | github.com/alexcarter",
  headingSize: 24,
  headingBorder: true,
  headingColor: "111111",
  headingCaps: true,
  margins: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
  bulletGlyph: "•",
  bodySize: 22,
  sections: [
    {
      title: "Education",
      entries: [{
        org: "University of California, Berkeley",
        dates: "Expected May 2026",
        subtitle: "B.A. in Computer Science — Berkeley, CA",
        bullets: ["GPA: 3.8/4.0; Dean's List (4 semesters)", "Relevant Coursework: Data Structures, Algorithms, Operating Systems, Databases"]
      }]
    },
    {
      title: "Experience",
      entries: [
        {
          org: "Campus Tech Collective",
          dates: "2024",
          subtitle: "Web Developer — Berkeley, CA",
          bullets: [
            "Built and maintained a React front end used by 1,200+ students for event sign-ups.",
            "Reduced page load time by 35% through code-splitting and image optimization."
          ]
        },
        {
          org: "Northwind Retail",
          dates: "Summer 2024",
          subtitle: "Data Analyst Intern — San Jose, CA",
          bullets: [
            "Automated weekly sales reporting in Python, saving the team ~6 hours per week.",
            "Built SQL dashboards that surfaced a 12% margin gap in two product lines."
          ]
        }
      ]
    },
    {
      title: "Skills",
      entries: [{
        org: "",
        lines: ["Java, Python, JavaScript, React, SQL, Git, HTML/CSS"]
      }]
    }
  ]
});

// --- Resume template: generic, modern sans-serif look -----------------------
const template = build({
  font: "Arial",
  name: "Firstname Lastname",
  nameCaps: false,
  nameSize: 36,
  contact: "City, State | your.email@example.com | (000) 000-0000 | linkedin.com/in/you",
  headingSize: 26,
  headingBorder: false,
  headingColor: "1F3864",
  headingCaps: false,
  margins: { top: 720, right: 720, bottom: 720, left: 720 },
  bulletGlyph: "▪",
  bodySize: 20,
  sections: [
    {
      title: "Education",
      entries: [{
        org: "University Name",
        dates: "Start – End",
        subtitle: "Degree, Major",
        bullets: ["GPA, honors, relevant coursework"]
      }]
    },
    {
      title: "Experience",
      entries: [{
        org: "Company Name",
        dates: "Start – End",
        subtitle: "Job Title — Location",
        bullets: ["Accomplishment with a measurable result.", "Another accomplishment with an action verb."]
      }]
    },
    {
      title: "Projects",
      entries: [{
        org: "Project Name",
        dates: "Year",
        bullets: ["What you built and the impact it had."]
      }]
    },
    {
      title: "Skills",
      entries: [{
        org: "",
        lines: ["List your languages, frameworks, and tools here"]
      }]
    }
  ]
});

async function main() {
  const outputs = [
    { doc: originalResume, dir: path.join(__dirname, "original-resume"), file: "alex-carter-resume.docx" },
    { doc: template, dir: path.join(__dirname, "template"), file: "modern-template.docx" }
  ];

  for (const { doc, dir, file } of outputs) {
    fs.mkdirSync(dir, { recursive: true });
    const buffer = await Packer.toBuffer(doc);
    const outputPath = path.join(dir, file);
    fs.writeFileSync(outputPath, buffer);
    console.log(`Wrote ${outputPath} (${buffer.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

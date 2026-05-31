# Work Experience

**Summary**: Four professional roles spanning product management (TikTok), startup leadership (NanoVisionAI), and finance/operations consulting (EAZZY, EverForward), plus an incoming Google Search Quality SWE internship documented in raw evidence.

**Sources**:
- Amilia_Liu_Resume.docx
- Google_SWE_Internship.md

**Last updated**: 2026-05-31T01:32:14.550Z

---

## Google — Software Engineering Intern (Incoming) | Mountain View, CA | June 2026 – September 2026

Documented in raw evidence (project repo `search-quality-reranker`, Search Quality, Q3 2026). Manager: James Park; Mentor: Dr. Sarah Chen, Staff Research Scientist (source: Google_SWE_Internship.md).

**Technical Leadership**
- Built a reranking layer that re-scores initial retrieval results using fine-tuned PaLM 2 embeddings, applying cross-lingual transfer (fine-tuning on high-resource language pairs, evaluating on low-resource targets with no additional labeled data) (source: Google_SWE_Internship.md).

**Quality Impact**
- Improved NDCG@10 by ~12% averaged across 8 languages, with Swahili improving 18% (source: Google_SWE_Internship.md). See [[impact-metrics]].

**Process / Tooling Improvement**
- Wrote an automated eval framework (Python orchestration + Go scoring pipeline on Borg) pulling golden sets from BigQuery, running inference, computing metrics, and posting to an internal dashboard — cutting the ranking-quality QA cycle from ~3 days to ~4 hours; adopted by two other Search teams (Ads ranking and Shopping) (source: Google_SWE_Internship.md).

**Collaboration / Scope**
- Worked with 4 engineers and 2 research scientists on a data-augmentation approach generating 1.2M synthetic query-document pairs via back-translation and paraphrasing (source: Google_SWE_Internship.md).
- Presented to ~60 people at the Search Quality all-hands; project approved for production deployment in Q4 2026 (source: Google_SWE_Internship.md).

**Tech stack**: Python, Go, TensorFlow, PaLM 2, BigQuery, Borg, Protocol Buffers, gRPC (source: Google_SWE_Internship.md). See [[skills]] and [[projects]].

> Note: This role's dates (June–Sept 2026) and TikTok's (Sep–Dec 2025) are both forward-dated relative to other entries; see [[open-questions]].

## TikTok — Product Manager Project Intern | San Jose, CA | Sep 2025 – Dec 2025

**Revenue & Risk Impact**
- Spearheaded the BRIC risk-control initiative: defined the product roadmap and led a cross-functional team of 6 engineers to build a governance pipeline from scratch, projected to reduce revenue leakage by 95% and cut signal-processing latency to under 15 seconds (source: Amilia_Liu_Resume.docx).
- Pioneered a content-moderation policy to eliminate digital panhandling from conflict regions, projected to reduce policy-violation reports by 15% and prevent ~$0.7M in exploitative revenue annually (source: Amilia_Liu_Resume.docx).

**Experimentation / Growth**
- Led an A/B testing initiative on user-safety prompts with marketing strategy, boosting proactive reports by 22% and cutting resolution time by 1.8 hours across 120K cases (source: Amilia_Liu_Resume.docx).

See [[impact-metrics]] for the strongest figures.

## NanoVisionAI — Co-Founder & Chief Executive Officer | New York, NY | Aug 2024 – Present

**Product & Technical Leadership**
- Launched the startup and led commercialization of an AI (LLM) tool that enhances resolution across microscopy systems by 3–7x in a sample-independent manner; work published in *Nature Communications* (source: Amilia_Liu_Resume.docx).
- Led AI product development from concept to commercialization, coordinating with 15 academic and industry partners for scalability and real-world applicability (source: Amilia_Liu_Resume.docx).

**Fundraising & Go-to-Market**
- Pitched the technology to 100+ investors in 6 months, defined the business model, and sourced clients for market expansion (source: Amilia_Liu_Resume.docx).

See [[projects]] and [[impact-metrics]].

## EAZZY Consulting — Financial Consulting Intern | Flushing, NY | May 2025 – Aug 2025

**Portfolio & Credit Analysis**
- Conducted portfolio management for 200+ SME and high-net-worth clients — underwriting credit risk, modeling cash-flow viability, and assessing growth potential to maximize risk-adjusted returns (source: Amilia_Liu_Resume.docx).

**Financial Modeling Impact**
- Built financial projections and scenario models in Python supporting a $2M debt/equity raise for a Florida restaurant chain, uncovering operational efficiencies projected to lift unit-level ROI by 30% (source: Amilia_Liu_Resume.docx).

**Process Improvement**
- Developed a standardized, SQL-driven financial due-diligence and health-assessment framework, accelerating client onboarding by 25% while ensuring adherence to federal lending and regulatory standards (source: Amilia_Liu_Resume.docx).

## EverForward IRB Consulting — Team Lead, Operations | New York, NY | May 2022 – Oct 2023

**Automation / Technical Impact**
- Developed a Python-based scoring model automating initial evaluation of 100+ biomedical research studies, filtering by compliance risk and statistical power to reduce manual review time by 40% (source: Amilia_Liu_Resume.docx).

**Business Development**
- Designed a data-driven sourcing strategy screening 100+ high-probability clients; analyzed conversion metrics and pitched a quantifiable investment thesis, securing $120K in initial contracts with NYC hospitals (source: Amilia_Liu_Resume.docx).

## Related pages

- [[impact-metrics]]
- [[skills]]
- [[projects]]
- [[resume-bullets]]
- [[leadership-experience]]
- [[open-questions]]

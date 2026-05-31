# Google_SWE_Internship.md

**Summary**: Source summary for Google_SWE_Internship.md.

**Sources**:
- Google_SWE_Internship.md

**Last updated**: 2026-05-31T01:34:59.810Z

---

This source is connected to [[profile]], [[resume-bullets]], and the relevant experience pages.

## Key takeaways

- Source type: raw (source: Google_SWE_Internship.md)
- Readable text: Yes (source: Google_SWE_Internship.md)
- Detected section count: 0 (source: Google_SWE_Internship.md)
- Imported bullet count: 0 (source: Google_SWE_Internship.md)

## Detected sections

- Needs verification

## Imported bullets

- No bullet-style lines found.

## Extracted text

- # search-quality-reranker (source: Google_SWE_Internship.md)
- Internal project repo for the multilingual reranking pipeline (Search Quality, Q3 2026). (source: Google_SWE_Internship.md)
- ## What this does (source: Google_SWE_Internship.md)
- We noticed that search results for low-resource languages (Swahili, Tagalog, Bengali, etc.) had significantly worse NDCG scores compared to English. The existing ranking model had been trained mostly on English data and just didn't generalize well. (source: Google_SWE_Internship.md)
- I built a reranking layer that takes the initial retrieval results and re-scores them using fine-tuned PaLM 2 embeddings. The key insight was using cross-lingual transfer — we fine-tuned on high-resource language pairs and then evaluated on the target languages without additional labeled data. (source: Google_SWE_Internship.md)
- Results: NDCG@10 improved by ~12% averaged across 8 languages. Swahili saw the biggest jump at 18%. (source: Google_SWE_Internship.md)
- ## Evaluation framework (source: Google_SWE_Internship.md)
- One of the pain points on the team was that regression tests for ranking quality took about 3 days to run through the manual QA process. I wrote an automated eval framework in Python (orchestration) and Go (the actual scoring pipeline that runs on Borg). It pulls golden sets from BigQuery, runs inference, computes metrics, and posts results to an internal dashboard. (source: Google_SWE_Internship.md)
- After rolling this out, the QA cycle went from 3 days to about 4 hours. Two other teams on Search (Ads ranking and Shopping) adopted it too. (source: Google_SWE_Internship.md)
- ## Data augmentation (source: Google_SWE_Internship.md)
- Sarah (my mentor, Dr. Sarah Chen — Staff Research Scientist) and I worked with 4 other engineers and 2 research scientists on a data augmentation approach. We generated 1.2 million synthetic query-document pairs using back-translation and paraphrasing to fill coverage gaps in underserved markets. (source: Google_SWE_Internship.md)
- ## Presentation (source: Google_SWE_Internship.md)
- Presented the full project at the Search Quality all-hands (~60 people). VP of Search said it was one of the strongest intern projects in the cycle. Project got approved for production deployment in Q4 2026. (source: Google_SWE_Internship.md)
- ## Tech stack (source: Google_SWE_Internship.md)
- Python, Go, TensorFlow, PaLM 2, BigQuery, Borg, Protocol Buffers, gRPC (source: Google_SWE_Internship.md)
- ## Team (source: Google_SWE_Internship.md)
- Google Search Quality, Mountain View CA (source: Google_SWE_Internship.md)
- Internship: June 2026 – September 2026 (source: Google_SWE_Internship.md)
- Manager: James Park (source: Google_SWE_Internship.md)
- Mentor: Dr. Sarah Chen (source: Google_SWE_Internship.md)

## Related pages

- [[profile]]
- [[education]]
- [[work-experience]]
- [[leadership-experience]]
- [[skills]]
- [[resume-bullets]]
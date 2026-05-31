# search-quality-reranker

Internal project repo for the multilingual reranking pipeline (Search Quality, Q3 2026).

## What this does

We noticed that search results for low-resource languages (Swahili, Tagalog, Bengali, etc.) had significantly worse NDCG scores compared to English. The existing ranking model had been trained mostly on English data and just didn't generalize well.

I built a reranking layer that takes the initial retrieval results and re-scores them using fine-tuned PaLM 2 embeddings. The key insight was using cross-lingual transfer — we fine-tuned on high-resource language pairs and then evaluated on the target languages without additional labeled data.

Results: NDCG@10 improved by ~12% averaged across 8 languages. Swahili saw the biggest jump at 18%.

## Evaluation framework

One of the pain points on the team was that regression tests for ranking quality took about 3 days to run through the manual QA process. I wrote an automated eval framework in Python (orchestration) and Go (the actual scoring pipeline that runs on Borg). It pulls golden sets from BigQuery, runs inference, computes metrics, and posts results to an internal dashboard.

After rolling this out, the QA cycle went from 3 days to about 4 hours. Two other teams on Search (Ads ranking and Shopping) adopted it too.

## Data augmentation

Sarah (my mentor, Dr. Sarah Chen — Staff Research Scientist) and I worked with 4 other engineers and 2 research scientists on a data augmentation approach. We generated 1.2 million synthetic query-document pairs using back-translation and paraphrasing to fill coverage gaps in underserved markets.

## Presentation

Presented the full project at the Search Quality all-hands (~60 people). VP of Search said it was one of the strongest intern projects in the cycle. Project got approved for production deployment in Q4 2026.

## Tech stack

Python, Go, TensorFlow, PaLM 2, BigQuery, Borg, Protocol Buffers, gRPC

## Team

Google Search Quality, Mountain View CA
Internship: June 2026 – September 2026
Manager: James Park
Mentor: Dr. Sarah Chen

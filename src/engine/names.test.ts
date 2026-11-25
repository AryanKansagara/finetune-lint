import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guessSplit } from './formats.ts'

const all = (want: string, names: string) => { for (const n of names.split(' ')) assert.equal(guessSplit(n), want, n) }

test('names with an evaluation word are eval', () => all('eval', 'eval.jsonl support_eval.jsonl a-eval.jsonl eval2.jsonl v2eval.jsonl data.test.jsonl TEST.JSONL validation.csv valid.csv val_1.jsonl dev.json devset.jsonl evalSet.jsonl myEvalData.jsonl QAEval.jsonl supportEvaluation.json test2024.jsonl'))

test('names that only contain the letters, or say train, are train', () => all('train', 'retrieval-train.jsonl latest.jsonl customer-approval.jsonl contest.jsonl devices.csv medieval.jsonl interval.jsonl developer-chat.jsonl invalid.jsonl greatest.jsonl train.jsonl train_test.jsonl training-vs-eval.jsonl trainEval.jsonl evaluator.jsonl data.jsonl .jsonl évaluations.jsonl'))

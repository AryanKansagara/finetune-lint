import { Code, Link } from './ui.tsx'

const TOC: [string, string][] = [['formats', 'Accepted formats'], ['export', 'Getting your data out'], ['checks', 'What is checked'], ['tokens', 'Token estimate'], ['dupes', 'Duplicates and leakage'], ['cost', 'Cost and time'], ['split', 'Split and export'], ['privacy', 'Privacy and sync']]

export default function Docs() {
  return (
    <section className="page narrow docs">
      <div className="eyebrow">Docs · updated November 2026</div>
      <h1>Format guide and method</h1>
      <p className="lede">Finetune Lint reads the dataset files people actually feed to fine-tuning jobs, tells you line by line what is wrong, and writes back a clean file in the shape your trainer expects.</p>
      <nav className="toc" aria-label="On this page">{TOC.map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}</nav>

      <h2 id="formats">Accepted formats</h2>
      <p>JSONL (one JSON object per line), a JSON array, or CSV/TSV. The shape is detected per row, so mixed files work and are reported as mixed.</p>
      <h3>OpenAI chat (also Fireworks, Together, Axolotl <code>chat_template</code>)</h3>
      <Code label="JSONL" code={`{"messages": [{"role": "system", "content": "You are a support agent."}, {"role": "user", "content": "Where is my order?"}, {"role": "assistant", "content": "It shipped yesterday."}]}`} />
      <p>Tool calls follow the OpenAI schema: an assistant turn with <code>tool_calls: [{'{'}id, type: "function", function: {'{'}name, arguments{'}'}{'}'}]</code> where <code>arguments</code> is a JSON <em>string</em>, then a <code>tool</code> turn whose <code>tool_call_id</code> matches.</p>
      <h3>ShareGPT</h3>
      <Code label="JSONL" code={`{"conversations": [{"from": "human", "value": "Where is my order?"}, {"from": "gpt", "value": "It shipped yesterday."}]}`} />
      <h3>Alpaca</h3>
      <Code label="JSONL" code={`{"instruction": "Classify the ticket.", "input": "My card was charged twice.", "output": "billing"}`} />
      <p><code>prompt</code>/<code>completion</code> and <code>question</code>/<code>answer</code> pairs are read the same way.</p>
      <h3>Preference pairs (DPO, ORPO, KTO-style)</h3>
      <Code label="JSONL (TRL)" code={`{"prompt": [{"role": "user", "content": "Can I return worn boots?"}], "chosen": [{"role": "assistant", "content": "Yes, within 60 days..."}], "rejected": [{"role": "assistant", "content": "No."}]}`} />
      <p>Plain strings for prompt/chosen/rejected work too, as does OpenAI&rsquo;s <code>input</code> / <code>preferred_output</code> / <code>non_preferred_output</code> shape. A <code>label</code>, <code>class</code>, <code>category</code> or <code>intent</code> field is used for class balance and stratified splits.</p>
      <h3>CSV</h3>
      <p>Columns are guessed from their headers (<code>instruction</code>, <code>prompt</code>, <code>output</code>, <code>response</code>, <code>chosen</code>, <code>rejected</code>, <code>label</code>, <code>messages</code>...) and you can remap each one before importing. Quoted fields with newlines are fine; line numbers point at the line where the record starts.</p>
      <p>Parquet is not read in the browser. Convert it first: <code>pd.read_parquet("train.parquet").to_json("train.jsonl", orient="records", lines=True)</code>.</p>

      <h2 id="export">Getting your data out</h2>
      <h3>From a Hugging Face dataset</h3>
      <Code label="Python" code={`from datasets import load_dataset\nds = load_dataset("your-org/your-dataset", split="train")\nds.to_json("train.jsonl", lines=True)  # one row per line`} />
      <h3>From support tickets in Postgres</h3>
      <p>One chat row per resolved ticket, with the agent&rsquo;s final reply as the assistant turn:</p>
      <Code label="SQL (PostgreSQL)" code={`\\copy (\n  SELECT json_build_object(\n    'messages', json_build_array(\n      json_build_object('role', 'system', 'content', 'You are the support assistant for Acme.'),\n      json_build_object('role', 'user', 'content', t.first_message),\n      json_build_object('role', 'assistant', 'content', t.final_agent_reply)\n    ),\n    'intent', t.category\n  )\n  FROM tickets t\n  WHERE t.status = 'solved' AND t.csat >= 4\n) TO 'train.jsonl'`} />
      <p>Postgres <code>\copy</code> escapes backslashes in text output; if your text contains them, export with <code>psql -At -c "SELECT ..." &gt; train.jsonl</code> instead.</p>
      <h3>From an existing fine-tuning job</h3>
      <p>Download the training file you uploaded (OpenAI: Storage, then Files; Fireworks: <code>firectl get dataset</code> and the dataset page; Together: the Files API) and drop it in. Lint it before the next run.</p>

      <h2 id="checks">What is checked</h2>
      <ul>
        <li><b>Structure</b>: invalid JSON and unrecognised shapes (with line numbers), roles outside system/user/assistant/tool, empty turns, no user turn, a final turn that is not the assistant, system prompts after the first turn, back-to-back turns from the same role, tool-call schema (name, JSON-string arguments, id, matching tool results).</li>
        <li><b>Length</b>: estimated tokens per row against the context length you train at. Rows over it are truncated by the trainer, usually from the end, which deletes the answer you wanted it to learn.</li>
        <li><b>Duplicates and leakage</b>: see below.</li>
        <li><b>Personal data and secrets</b>: email addresses, phone numbers (10 to 15 digits), card numbers that pass the Luhn checksum, US SSNs, and API keys (OpenAI, Fireworks, AWS, GitHub, Slack, Google, Hugging Face, private key blocks, <code>api_key=</code> assignments). Regex based: it catches the common cases, not names or street addresses.</li>
        <li><b>Refusals</b>: assistant turns that refuse (&ldquo;As an AI language model&rdquo;, &ldquo;I can&rsquo;t help with that&rdquo;). A few hundred of these teach a tuned model to refuse things it should answer.</li>
        <li><b>Boilerplate</b>: reply openers shared by 4% or more of replies (&ldquo;Certainly! I&rsquo;d be happy to help&rdquo;). Fine-tunes copy verbal tics faithfully.</li>
        <li><b>Language</b>: script ranges for CJK, Cyrillic, Arabic, Devanagari, Greek, Hebrew and Thai; character-trigram profiles plus stop words for English, Spanish, French, German, Portuguese, Italian and Dutch. Rows outside the dominant language are flagged as info.</li>
        <li><b>Class balance</b>: from a label field, or inferred when 80% of final answers are four words or fewer drawn from a small set.</li>
        <li><b>Preference pairs</b>: chosen equal to rejected, a missing side, and length bias (chosen longer in over 75% or under 25% of pairs).</li>
      </ul>

      <h2 id="tokens">Token estimate</h2>
      <p>No tokenizer is downloaded. Text is split with the same pre-tokenizer pattern GPT-4-family tokenizers use (words with a leading space or glued punctuation, 1 to 3 digit chunks, punctuation runs, whitespace), and each piece is charged by length, case and script. Each turn adds 4 tokens of chat-template overhead (Llama 3 and ChatML both use about that) and each row adds 1.</p>
      <p>Measured against <code>tiktoken</code> <code>cl100k_base</code> in November 2026: <b>2.9% mean absolute error per turn and +1.8% on the total</b> for the synthetic support chats; 6.5% per document and +3.4% in total on 72 README files with markdown, URLs and code. Against <code>o200k_base</code>: 4.4% per turn. Llama 3, Qwen 2.5 and Mistral tokenizers differ from cl100k by a few percent on English. Expect larger error on CJK text, emoji and minified code. Treat the numbers as planning estimates, not invoices.</p>

      <h2 id="dupes">Duplicates and leakage</h2>
      <p>Exact duplicates compare a 64-bit hash of the text after lowercasing, Unicode normalisation and stripping punctuation. System prompts are left out, because a shared system prompt would make every row look alike.</p>
      <p>Near duplicates use MinHash over word 3-grams (64 hash functions) with locality-sensitive hashing in 16 bands of 4. Candidate pairs are kept when their estimated Jaccard similarity is at or above the threshold (80% by default, adjustable).</p>
      <p>Leakage compares every eval row against train: an exact match of the prompt (every turn except the final answer) or a near duplicate of the whole row. Leaked rows make eval loss look better than the model is.</p>

      <h2 id="cost">Cost and time</h2>
      <p><code>training tokens = Σ min(row tokens, context) over train rows × epochs</code>. Preference pairs count both sequences (prompt + chosen and prompt + rejected). <code>cost = training tokens / 1,000,000 × price</code>; <code>time = training tokens / throughput</code>.</p>
      <p>The default price of $0.50 per million training tokens and 6,000 tokens per second are placeholders, not quotes. Providers price fine-tuning by model size and method (LoRA vs full, SFT vs DPO), and change prices often. Enter the rate from your provider&rsquo;s pricing page on the day you plan the run, and treat the time as a rough order of magnitude.</p>

      <h2 id="split">Split and export</h2>
      <p>The split is stratified by class label when there is one, otherwise by token-length quartile, so eval looks like train. Exact and near-duplicate clusters are assigned as a unit, so a fresh split cannot leak. It is seeded by the version number, so it is reproducible.</p>
      <p>Exports: OpenAI chat JSONL (accepted by Fireworks, Together, OpenAI and Axolotl&rsquo;s chat template loader), ShareGPT, Alpaca (single-turn rows only) and TRL preference JSONL. Rows that cannot be represented in the chosen format are counted and skipped, never silently mangled. Fix-ups:</p>
      <ul>
        <li>Normalise roles: <code>human</code>, <code>customer</code> → user; <code>gpt</code>, <code>bot</code>, <code>model</code> → assistant; <code>function</code>, <code>observation</code> → tool; system prompts merged and moved first; back-to-back turns from one role merged.</li>
        <li>Strip personal data with <code>[EMAIL]</code>, <code>[PHONE]</code>, <code>[CARD]</code>, <code>[SSN]</code>, <code>[SECRET]</code>.</li>
        <li>Fit the context: drop the oldest middle exchanges, keeping the system prompt and the final exchange; drop the row if it still does not fit.</li>
        <li>Dedupe (exact, near), drop leaked eval rows, drop broken rows, drop refusals (off by default), drop identical preference pairs.</li>
      </ul>

      <h2 id="privacy">Privacy and sync</h2>
      <p>Files are parsed and analysed in your browser (a Web Worker); nothing is uploaded to lint it. Datasets are stored in this browser&rsquo;s IndexedDB. Signing in is optional: it syncs project settings, fix choices, version summaries, and the current rows when they are under 1.5 MB. Rows saved with older versions stay on the device where you made them. You can export everything as JSON or delete your cloud data and account from the account menu.</p>
      <p className="muted small">Questions about a format not covered here? The samples on the <Link href="/app">Datasets</Link> page use every shape above.</p>
    </section>
  )
}

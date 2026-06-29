# Ornith-1.0 Research Summary

**Ornith-1.0** is a state-of-the-art family of open-source, reinforcement-learning-based Large Language Models specifically designed for agentic coding. Developed by **DeepReinforce.AI** and released in June 2026, the Ornith family pioneers a novel **"self-scaffolding"** approach, allowing the models to autonomously generate their own execution strategies.

The models are MIT licensed, available on Hugging Face, and can be seamlessly run locally via Ollama.

---

## 🚀 Core Innovation: Self-Scaffolding

Unlike traditional coding agents that rely on static, human-engineered harnesses to manage execution loops (tool routing, state management, error handling), Ornith-1.0 co-evolves the execution scaffold alongside its policy during training.

> [!TIP]
> **Self-Scaffolding Mechanism:** The model treats the scaffold as a learnable, executable object, enabling dynamic adaptation to specific coding tasks. Higher-reward scaffolds are mutated and selected automatically over training via an asynchronous pipeline-RL setup and token-level GRPO objective.

### Two-Stage Execution Flow
1. **Harness Generation**: Before tackling a task, the model analyzes the task description and available tools to generate a custom, inspectable Python harness. This harness dictates exactly how the task will be executed, defining tool selection, conditional branching, fallback logic, and termination criteria.
2. **Solution Rollout**: Utilizing the generated custom harness, the model proceeds to generate the solution rollout.

---

## 🧠 Architecture & Model Variants

The Ornith-1.0 family is post-trained on top of pretrained **Gemma 4** and **Qwen 3.5** architectures and operates as a **reasoning model**, opening every response with a `<think>` block before the final output. It features a massive **256K context window**.

Available variants:
- **9B Dense**: Highly efficient edge model; fits on a single 80GB GPU (~19GB in bf16).
- **31B Dense**: A mid-range powerhouse.
- **35B MoE**: Mixture-of-Experts architecture, activating roughly 3B parameters per token for efficient inference.
- **397B MoE**: The flagship model designed for maximum accuracy on extensive, multi-step tasks.

> [!NOTE]
> Serving recipes support parsing the `<think>` trace into a separate `reasoning_content` field, maintaining a cleaner final output.

---

## 🛡️ Guarding Against Reward Hacking

Because the model writes its own execution environments, it inherently possesses the risk of "cheating" during training (e.g., modifying validation scripts). To mitigate this, DeepReinforce implemented a rigorous three-layer defense system:

1. **Outer Trust Boundary (Immutable)**: The core execution environment, tool surface, and test isolation mechanisms are completely fixed and inaccessible to the model.
2. **Deterministic Monitor**: A system that automatically flags banned actions (such as reading withheld paths) and immediately assigns a zero reward to those trajectories.
3. **Frozen LLM Judge**: Acts as a final veto mechanism sitting above the verifier.

---

## 📊 Benchmarks & Performance

Ornith-1.0 models claim state-of-the-art performance among open-source models of comparable size. 

| Model Variant | SWE-Bench Verified | Terminal-Bench 2.1 | Notes |
|---------------|--------------------|--------------------|-------|
| **9B Dense**  | 69.4               | 43.1               | Exceptional for local/edge setups. |
| **397B MoE**  | 82.4               | 77.5               | Beats Claude Opus 4.7, trails Claude Opus 4.8 and GLM-5.2-744B. |

---

## 💻 Usage with Ollama

Ornith-1.0 is compatible with the **Ollama** library, supporting FP8 and GGUF builds, and exposing an OpenAI-compatible endpoint. It readily integrates into frameworks like OpenHands, OpenClaw, and OpenCode.

**CLI Usage:**
```bash
ollama run ornith:9b
```

**Python Quickstart:**
```python
from ollama import chat

response = chat(
    model='ornith', 
    messages=[{"role": "user", "content": "Write a Python is_prime(n)."}]
)

print(response['message']['content'])
```

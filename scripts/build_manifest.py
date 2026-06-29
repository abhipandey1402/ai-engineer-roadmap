#!/usr/bin/env python3
"""Builds per-section source bundles from a roadmap.sh roadmap so content-authoring
agents can enrich them into the app's JSON data files.
Usage: build_manifest.py [--course ai-engineer|python]"""
import json, os, re, sys

COURSE = sys.argv[sys.argv.index('--course') + 1] if '--course' in sys.argv else 'ai-engineer'
CONTENT = f'/tmp/dev-roadmap/src/data/roadmaps/{COURSE}/content'
OUT = os.path.join(os.path.dirname(__file__), '..', 'content-src', COURSE)

# (section_id, section_title, section_description, [(node_id, title, subsection)])
SECTIONS_AI = [
    ("introduction", "Introduction", "What an AI Engineer is, what they do, and how the role differs from ML engineering.", [
        ("GN6SnI7RXIeW8JeD-qORW", "What is an AI Engineer?", None),
        ("K9EiuFgPBFgeRxY4wxAmb", "Roles and Responsibilities", None),
        ("qJVgKe9uBvXc-YPfvX_Y7", "Impact on Product Development", None),
        ("jSZ1LhPdhlkW-9QJhIvFs", "AI Engineer vs ML Engineer", None),
    ]),
    ("how-llms-work", "How LLMs Work & Core Terminology", "The foundational vocabulary and mechanics behind large language models.", [
        ("wf2BSyUekr1S1q6l8kyq6", "Large Language Model (LLM)", "Common Terminology"),
        ("5QdihE1lLpMc3DFrGy46M", "AI vs AGI", "Common Terminology"),
        ("xostGgoaYkqMO28iN2gx8", "Training", "Common Terminology"),
        ("4NtUD9V64gkp8SFudj_ai", "Inference", "Common Terminology"),
        ("XyEp6jnBSpCxMGwALnYfT", "Embeddings", "Common Terminology"),
        ("dzPKW_fn82lY1OOVrggk3", "Vector Databases", "Common Terminology"),
        ("IX1BJWGwGmB4L063g0Frf", "RAG", "Common Terminology"),
        ("Uffu609uQbIzDl88Ddccv", "AI Agents", "Common Terminology"),
        ("zTvsCNS3ucsZmvy1tHyeI", "Fine-tuning", "Common Terminology"),
        ("VjXmSCdzi2ACv-W85Sy9D", "Prompt Engineering", "Common Terminology"),
        ("kCiHNaZ9CgnS9uksIQ_SY", "Context Engineering", "Common Terminology"),
        ("2WbVpRLqwi3Oeqk1JPui4", "Tokens", "Core LLM Elements"),
        ("vvpYkmycH0_W030E-L12f", "Context", "Core LLM Elements"),
        ("LbB2PeytxRSuU07Bk0KlJ", "Sampling Parameters", "Core LLM Elements"),
        ("_bPTciEA1GT1JwfXim19z", "Temperature", "Core LLM Elements"),
        ("qzvp6YxWDiGakA2mtspfh", "Top-K", "Core LLM Elements"),
        ("FjV3oD7G2Ocq5HhUC17iH", "Top-P", "Core LLM Elements"),
        ("0_pa739kMPWHfuSQV-VO7", "Repetition Penalties", "Core LLM Elements"),
    ]),
    ("prompt-engineering", "Prompt Engineering", "Techniques for writing effective prompts: shot strategies, reasoning patterns, structure, and API features.", [
        ("S46Vaq8hYq6Ee1Id_-fSQ", "System Prompting", "Prompt Fundamentals"),
        ("N3TzWYxU0jgv1l99Ts58n", "Role & Behavior", "Prompt Fundamentals"),
        ("9oUpeEnaMWctQLTobbmY7", "Context", "Prompt Fundamentals"),
        ("PT3uDiUjiKhO8laOkCmgP", "Constraints", "Prompt Fundamentals"),
        ("LCHse57rXf3sl8ml1ow0T", "Input Format", "Prompt Fundamentals"),
        ("15XOFdVp0IC-kLYPXUJWh", "Zero-Shot Prompting", "Prompting Techniques"),
        ("DZPM9zjCbYYWBPLmQImxQ", "Few-Shot Prompting", "Prompting Techniques"),
        ("nyBgEHvUhwF-NANMwkRJW", "Chain of Thought (CoT)", "Prompting Techniques"),
        ("Waox7xR_yUeSnOtQFzU4c", "ReAct", "Prompting Techniques"),
        ("wFfjHkGLrcCyLyXV4BiFM", "Function Calling", "API Features"),
        ("zqhmLzHsmDlrTFVHzhq6-", "Structured Output", "API Features"),
        ("bqqY0gsZkBpcHMZw1hcZ5", "Prompt Caching", "API Features"),
        ("MUDBYjR7uCUZQ-kQxi2K_", "Streaming Responses", "API Features"),
    ]),
    ("context-engineering", "Context Engineering", "Designing everything the model sees: memory, retrieval, compaction, and isolation strategies.", [
        ("ozrR8IvjNFbHd44kZrExX", "Prompt vs Context Engineering", None),
        ("KWjD4xEPhOOYS51dvRLd2", "External Memory", None),
        ("LnQ2AatMWpExUHcZhDIPd", "RAG and Dynamic Filters", None),
        ("9XCxilAQ7FRet7lHQr1gE", "Context Compaction", None),
        ("9JwWIK0Z2MK8-6EQQJsCO", "Context Isolation", None),
    ]),
    ("ai-models", "AI Models", "The model landscape: closed vs open source, major providers, and how to choose.", [
        ("2X0NDcq2ojBJ0RxY_U6bl", "Types of Models", "Fundamentals"),
        ("d7fzv_ft12EopsQdmEsel", "Pre-trained Models", "Fundamentals"),
        ("RBwGsq9DngUsl8PrrCbqx", "Closed vs Open Source Models", "Fundamentals"),
        ("_qqITQ8O0Q0RWUeZsUXnY", "Self-Hosted Models", "Fundamentals"),
        ("zeWoTtAFEpVXDQzWNsha4", "Choosing the Right Model", "Fundamentals"),
        ("hy6EyKiNxk1x84J63dhez", "Anthropic Claude", "Closed Models"),
        ("oe8E6ZIQWuYvHVbYJHUc1", "Google Gemini", "Closed Models"),
        ("3PQVZbcr4neNMRr6CuNzS", "OpenAI (GPT, o-series)", "Closed Models"),
        ("n-Ud2dXkqIzK37jlKItN4", "Mistral", "Closed Models"),
        ("a7qsvoauFe5u953I699ps", "Cohere", "Closed Models"),
        ("OkYO-aSPiuVYuLXHswBCn", "Meta Llama", "Open Source Models"),
        ("UGYYh2W1XnnbgYNY8L8Hb", "DeepSeek", "Open Source Models"),
        ("MNtaY1_kOJHeoWuM-abb4", "Gemma", "Open Source Models"),
        ("c0RPhpD00VIUgF4HJgN2T", "Qwen", "Open Source Models"),
    ]),
    ("platforms-apis", "Platforms, Ecosystem & APIs", "Hugging Face, local model runners, routers, and the major provider SDKs.", [
        ("v99C5Bml2a6148LCJ9gy9", "Hugging Face", "Platforms"),
        ("YKIPOiSj_FNtg0h8uaSMq", "Hugging Face Tasks", "Platforms"),
        ("YLOdOvLXa5Fa7_mmuvKEi", "Hugging Face Hub", "Platforms"),
        ("bGLrbpxKgENe2xS1eQtdh", "Transformers.js", "Platforms"),
        ("rTT2UnvqFO3GH6ThPLEjO", "Ollama", "Local Runners"),
        ("a_3SabylVqzzOyw3tZN5f", "LM Studio", "Local Runners"),
        ("1GlpMjmdAWor0X_BnISGg", "OpenRouter", "Local Runners"),
        ("ro3vY_sp6xMQ-hfzO-rc1", "OpenAI Responses API", "APIs & SDKs"),
        ("nxwMVla0-PNG8nlocKK5v", "Claude Messages API", "APIs & SDKs"),
        ("TsG_I7FL-cOCSw8gvZH3r", "Google Gemini API", "APIs & SDKs"),
        ("3kRTzlLNBnXdTsAEXVu_M", "Hugging Face Inference SDK", "APIs & SDKs"),
        ("vnXtUupJUlyU_uCbZBbnk", "OpenAI-compatible APIs", "APIs & SDKs"),
    ]),
    ("embeddings", "Embeddings", "What embeddings are, what they're used for, and the main embedding model families.", [
        ("--ig0Ume_BnXb9K2U7HJN", "What are Embeddings", "Fundamentals"),
        ("eMfcyBxnMY_l_5-8eg6sD", "Semantic Search", "Use Cases"),
        ("06Xta-OqSci05nV2QMFdF", "Data Classification", "Use Cases"),
        ("HQe9GKy3p0kTUPxojIfSF", "Recommendation Systems", "Use Cases"),
        ("AglWJ7gb9rTT2rMkstxtk", "Anomaly Detection", "Use Cases"),
        ("fr0UOXlVVctkk1K84Z8Of", "Embedding Models", "Models"),
        ("l6priWeJhbdUD5tJ7uHyG", "OpenAI Embeddings API", "Models"),
        ("4GArjDYipit4SLqKZAWDf", "Gemini Embedding", "Models"),
        ("y0qD5Kb4Pf-ymIwW-tvhX", "Cohere Embed", "Models"),
        ("ZV_V6sqOnRodgaw4mzokC", "Sentence Transformers", "Models"),
        ("dLEg4IA3F5jgc44Bst9if", "Models on Hugging Face", "Models"),
        ("apVYIV4EyejPft25oAvdI", "Jina Embeddings", "Models"),
    ]),
    ("vector-databases", "Vector Databases", "Storing and searching embeddings: the major vector DBs and how similarity search works.", [
        ("tt9u3oFlsjEMfPyojuqpc", "Vector Databases Overview", "Fundamentals"),
        ("WcjX6p-V-Rdd77EL8Ega9", "Purpose and Functionality", "Fundamentals"),
        ("dSd2C9lNl-ymmCRT9_ZC3", "Chroma", "Popular Vector DBs"),
        ("_Cf7S1DCvX7p1_3-tP3C3", "Pinecone", "Popular Vector DBs"),
        ("VgUnrZGKVjAAO4n_llq5-", "Weaviate", "Popular Vector DBs"),
        ("JurLbOO1Z8r6C3yUqRNwf", "FAISS", "Popular Vector DBs"),
        ("rjaCNT3Li45kwu2gXckke", "LanceDB", "Popular Vector DBs"),
        ("DwOAL5mOBgBiw-EQpAzQl", "Qdrant", "Popular Vector DBs"),
        ("9kT7EEQsbeD2WDdN9ADx7", "Supabase (pgvector)", "Popular Vector DBs"),
        ("j6bkm0VUgLkHdMDDJFiMC", "MongoDB Atlas Vector Search", "Popular Vector DBs"),
        ("5TQnO9B4_LTHwqjI7iHB1", "Indexing Embeddings", "Implementing Vector Search"),
        ("ZcbRPtgaptqKqWBgRrEBU", "Performing Similarity Search", "Implementing Vector Search"),
    ]),
    ("rag", "RAG & Implementation", "Retrieval-Augmented Generation end to end: the pipeline stages and the frameworks that implement them.", [
        ("lVhWhZGR558O-ljHobxIi", "What is RAG?", "Fundamentals"),
        ("GCn4LGNEtPI0NWYAZCRE-", "RAG Use Cases", "Fundamentals"),
        ("qlBEXrbV88e_wAGRwO9hW", "RAG vs Fine-tuning", "Fundamentals"),
        ("mX987wiZF7p3V_gExrPeX", "Chunking", "The RAG Pipeline"),
        ("grTcbzT7jKk_sIUwOTZTD", "Embedding", "The RAG Pipeline"),
        ("zZA1FBhf1y4kCoUZ-hM4H", "Vector Database", "The RAG Pipeline"),
        ("OCGCzHQM2LQyUWmiqe6E0", "Retrieval Process", "The RAG Pipeline"),
        ("2jJnS9vRYhaS69d6OxrMh", "Generation", "The RAG Pipeline"),
        ("WZVW8FQu6LyspSKm1C_sl", "Using SDKs Directly", "Ways of Implementing RAG"),
        ("jM-Jbo0wUilhVY830hetJ", "LangChain", "Ways of Implementing RAG"),
        ("JT4mBXOjvvrUnynA7yrqt", "LlamaIndex", "Ways of Implementing RAG"),
        ("ebXXEhNRROjbbof-Gym4p", "Haystack", "Ways of Implementing RAG"),
        ("d0ontCII8KI8wfP-8Y45R", "RAGFlow", "Ways of Implementing RAG"),
    ]),
    ("ai-agents", "AI Agents", "Agents that reason, use tools, and act — from manual loops to agent SDKs.", [
        ("4_ap0rD9Gl6Ep_4jMfPpG", "What are AI Agents?", "Fundamentals"),
        ("778HsQzTuJ_3c9OSn5DmH", "Agent Use Cases", "Fundamentals"),
        ("voDKcKvXtyLzeZdx2g3Qn", "ReAct Prompting", "Fundamentals"),
        ("eOqCBgBTKM8CmY3nsWjre", "Tools & Function Calling", "Fundamentals"),
        ("kG1bkF2oY21CJOm9zhdpn", "Multi-Agent Systems", "Fundamentals"),
        ("6xaRB34_g0HGt-y1dGYXR", "Manual Implementation", "Building AI Agents"),
        ("Sm0Ne5Nx72hcZCdAcC0C2", "OpenAI AgentKit & Agents SDK", "Building AI Agents"),
        ("xXLyuUNrKEc32XLQxMjgT", "Claude Agent SDK", "Building AI Agents"),
        ("AxzTGDCC2Ftp4G66U4Uqr", "Vertex AI Agent Builder", "Building AI Agents"),
        ("mbp2NoL-VZ5hZIIblNBXt", "Google ADK", "Building AI Agents"),
    ]),
    ("mcp", "Model Context Protocol (MCP)", "The open standard for connecting LLMs to tools and data: architecture, servers, clients, and transports.", [
        ("AeHkNU-uJ_gBdo5-xdpEu", "What is MCP?", "Fundamentals"),
        ("MabZ9jOrSj539C5qZrVBd", "MCP Host", "Core Components"),
        ("po0fIZYaFhRbNlza7sB37", "MCP Client", "Core Components"),
        ("8Xkd88EjX3GE_9DWQhr7G", "MCP Server", "Core Components"),
        ("Z0920V57_ziDhXbQJMN9O", "Data Layer", "Core Components"),
        ("o4gHDZ5p9lyeHuCAPvAKz", "Transport Layer", "Core Components"),
        ("oLGfKjcqBzJ3vd6Cg-T1B", "Building an MCP Server", "Hands-On"),
        ("0Rk0rCbmRFJT2GKwUibQS", "Building an MCP Client", "Hands-On"),
        ("H-G93SsEgsA_NGL_v4hPv", "Connect to a Local Server", "Hands-On"),
        ("2t4uINxmzfx8FUF-_i_2B", "Connect to a Remote Server", "Hands-On"),
    ]),
    ("ai-safety", "AI Safety and Ethics", "Security threats, bias, moderation, and the best practices for shipping AI responsibly.", [
        ("8ndKHDJgL_gYwaXC7XMer", "AI Safety and Ethics Overview", "Understanding AI Safety Issues"),
        ("cUyLT6ctYQ1pgmodCKREq", "Prompt Injection Attacks", "Understanding AI Safety Issues"),
        ("sWBT-j2cRuFqRFYtV_5TK", "Security and Privacy Concerns", "Understanding AI Safety Issues"),
        ("lhIU0ulpvDAn1Xc3ooYz_", "Bias and Fairness", "Understanding AI Safety Issues"),
        ("ljZLa3yjQpegiZWwtnn_q", "Content Moderation APIs", "Safety Best Practices"),
        ("4Q5x2VCXedAWISBXUIyin", "Adding End-User IDs in Prompts", "Safety Best Practices"),
        ("Pt-AJmSJrOxKvolb5_HEv", "Adversarial Testing", "Safety Best Practices"),
        ("qmx6OHqx4_0JXVIv8dASp", "Robust Prompt Engineering", "Safety Best Practices"),
        ("t1SObMWkDZ1cKqNNlcd9L", "Know Your Customers / Use Cases", "Safety Best Practices"),
        ("ONLDyczNacGVZGojYyJrU", "Constraining Outputs and Inputs", "Safety Best Practices"),
    ]),
    ("observability-evals", "LLM Observability & Evaluations", "Tracing, monitoring, and systematically evaluating LLM applications in production.", [
        ("1bBgMVISENC-XBwuZFlUk", "LLM Observability", "Observability"),
        ("cdapQf0Owxdx6olAHTrbq", "Tracing & Logging", "Observability"),
        ("CG3XTMPug98s-EP0_rn1Y", "Cost & Latency Monitoring", "Observability"),
        ("3gwVG4XaO83z3Yzdd84Z-", "Production Monitoring", "Observability"),
        ("bN_ReFUQgkJmWOAFMLXMg", "LangSmith", "Observability Tools"),
        ("Xw6-crHimGrVC1u1xujc6", "Langfuse", "Observability Tools"),
        ("82LE-qxw1H_FYfVUdgkN9", "Helicone", "Observability Tools"),
        ("jx57heeBnacrlCyQPhlEi", "Arize AI", "Observability Tools"),
        ("FJ3ZwbTdiFyebrFi96tnz", "LLM Evaluations", "Evaluations"),
        ("kSDTJK74Tq0KHBfIawJuT", "Deterministic Evals", "Evaluation Types"),
        ("LJ6_U5lOdc0uRngutj7Ro", "Model-Based Evals (LLM-as-Judge)", "Evaluation Types"),
        ("QIx5nT75l2Cn2q75-TxfD", "Human Evals", "Evaluation Types"),
        ("Z8MBleL51wJuV9BkS1djI", "Evaluation Metrics", "Evaluation Types"),
        ("Bkzi3QyzKyHxcHE7sodRZ", "Regression Testing", "Evaluation Types"),
        ("hyN5v8dg1lHJLpdZZdtJE", "DeepEval", "Evaluation Tools"),
        ("CZ_-PSDzzSrSon5XdzLen", "RAGAS", "Evaluation Tools"),
    ]),
    ("multimodal", "Multimodal AI", "Models that work across text, images, audio, and video — tasks and APIs.", [
        ("W7cKPt_UxcUgwp8J6hS4p", "What is Multimodal AI?", "Fundamentals"),
        ("sGR9qcro68KrzM8qWxcH8", "Multimodal Use Cases", "Fundamentals"),
        ("fzVq4hGoa2gdbIzoyY1Zp", "Image Understanding", "Multimodal Tasks"),
        ("49BWxYVFpIgZCCqsikH7l", "Image Generation", "Multimodal Tasks"),
        ("TxaZCtTCTUfwCxAJ2pmND", "Video Understanding", "Multimodal Tasks"),
        ("mxQYB820447DC6kogyZIL", "Audio Processing", "Multimodal Tasks"),
        ("GCERpLz5BcRtWPpv-asUz", "Text-to-Speech", "Multimodal Tasks"),
        ("jQX10XKd_QM5wdQweEkVJ", "Speech-to-Text", "Multimodal Tasks"),
        ("CRrqa-dBw1LlOwVbrZhjK", "OpenAI Vision API", "Implementing Multimodal AI"),
        ("LKFwwjtcawJ4Z12X102Cb", "DALL-E API", "Implementing Multimodal AI"),
        ("6y73FLjshnqxV8BTGUeiu", "NanoBanana (Gemini Image) API", "Implementing Multimodal AI"),
        ("OTBd6cPUayKaAM-fLWdSt", "Whisper API", "Implementing Multimodal AI"),
        ("EIDbwbdolR_qsNKVDla6V", "Hugging Face Multimodal Models", "Implementing Multimodal AI"),
        ("j9zD3pHysB1CBhLfLjhpD", "LangChain for Multimodal Apps", "Implementing Multimodal AI"),
        ("akQTCKuPRRelj2GORqvsh", "LlamaIndex for Multimodal Apps", "Implementing Multimodal AI"),
    ]),
    ("dev-tools", "AI-Assisted Coding Tools", "The agentic coding tools that are changing how software gets built.", [
        ("NYge7PNtfI-y6QWefXJ4d", "Development Tools Overview", None),
        ("wr5ddjutC-fX_ixysTHaT", "Claude Code", None),
        ("hzeEo8COf2l07iu5EdlFo", "Gemini CLI", None),
        ("XY2l96sry3WyLzzo3KUeU", "Codex", None),
        ("MWhoqhNnBaoeCdN_8i15k", "Cursor", None),
        ("Xsl8mx6J182TxPPtNP471", "Windsurf", None),
        ("Ubk4GN0Z4XlDJ3EbRXdxg", "Replit", None),
    ]),
]

SECTIONS_PYTHON = [
    ("getting-started", "Getting Started", "What Python is, where it's used, and how to set up and run it.", [
        ("GISOFMKvnBys0O0IMpz2J", "Learn the Basics", None),
    ]),
    ("language-basics", "Language Basics", "Syntax, variables, operators, strings, and control flow.", [
        ("6xRncUs3_vxVbDur567QA", "Basic Syntax", None),
        ("dEFLBGpiH6nbSMeR7ecaT", "Variables and Data Types", None),
        ("so95CO6Qw3I0S98ISENS-", "Operators", None),
        ("R9DQNc0AyAQ2HLpP4HOk6", "Type Casting", None),
        ("Sg5w8zO2Ji-uDJKEoWey9", "Working with Strings", None),
        ("NP1kjSk0ujU0Gx-ajNHlR", "Conditionals", None),
        ("Dvy7BnNzK55qbh_SgOk8m", "Loops", None),
    ]),
    ("functions-scope", "Functions & Scope", "Defining and using functions, built-ins, lambdas, and scope.", [
        ("-DJgS6l2qngfwurExlmmT", "Functions", None),
        ("08XifLQ20c4FKI_4AWNBQ", "Builtin Functions", None),
        ("aWHgAk959DPUZL46CeRiI", "Lambdas", None),
        ("3RNy7Sp28d-NMx0Yh4bdx", "Variable Scope", None),
    ]),
    ("data-structures", "Data Structures", "Python's core collections and comprehensions.", [
        ("UT_SR7G-LYtzqooWrEtF1", "Lists", None),
        ("i7xIGiXU-k5UIKHIhQPjE", "Tuples", None),
        ("soZFqivM3YBuljeX6PoaX", "Sets", None),
        ("bc9CL_HMT-R6nXO1eR-gP", "Dictionaries", None),
        ("4gtmtYWYRWqwLdZRL0XMg", "List Comprehensions", None),
        ("jnLIVRrWxcX3yq3Op91Vr", "Generator Expressions", None),
    ]),
    ("oop", "Object-Oriented Programming", "Classes, methods, inheritance, encapsulation, and paradigms.", [
        ("P_Di-XPSDITmU3xKQew8G", "OOP Overview", None),
        ("AqwzR8dZKLQIoj_6KKZ3t", "Classes", None),
        ("zAS4YiEJ6VPsyABrkIG8i", "Methods", None),
        ("S0FLE70szSVUPI0CDEQK7", "Inheritance", None),
        ("3dC2o3WXdx4plFhDP2Vqk", "Encapsulation", None),
        ("4GU5HNi3W8yFkImVY9ZpW", "Programming Paradigms", None),
    ]),
    ("errors-files-text", "Errors, Files & Text", "Exceptions, file handling, context managers, and regular expressions.", [
        ("fNTb9y3zs1HPYclAmu_Wv", "Exceptions", None),
        ("Nf3kRDSl_vas6QPXG7eVa", "File Handling", None),
        ("KAXF2kUAOvtBZhY8G9rkI", "Context Managers", None),
        ("bqnwMKY4R0rirup3q_hb_", "Glob", None),
        ("7t6mJBsaFMWPi7o9fbhhq", "Regular Expressions", None),
    ]),
    ("advanced-python", "Advanced Python", "Decorators, iterators, and modules.", [
        ("pIluLJkySqn_gI_GykV6G", "Decorators", None),
        ("aB1LSQjDEQb_BxueOcnxU", "Iterators", None),
        ("274uk28wzxn6EKWQzLpHs", "Modules", None),
    ]),
    ("dsa", "Data Structures & Algorithms", "Core data structures and algorithms in Python.", [
        ("VJSIbYJcy2MC6MOFBrqXi", "DSA Overview", None),
        ("OPD4WdMO7q4gRZMcRCQh1", "Arrays and Linked Lists", None),
        ("0NlRczh6ZEaFLlT6LORWz", "Heaps, Stacks and Queues", None),
        ("DG4fi1e5ec2BVckPLsTJS", "Hashmaps", None),
        ("uJIqgsqUbE62Tyo3K75Qx", "Binary Search Tree", None),
        ("kLBgy_nxxjE8SxdVi04bq", "Recursion", None),
        ("vvTmjcWCVclOPY4f_5uB0", "Sorting Algorithms", None),
    ]),
    ("environments-packaging", "Environments & Packaging", "Virtual environments, package managers, and project config.", [
        ("qeCMw-sJ2FR4UxvU9DDzv", "Package Managers", None),
        ("iVhQnp6hpgVZDNJ0XoVra", "pip", None),
        ("1dfOTOGsOk5XE3bnZs8Ht", "PyPI", None),
        ("_IXXTSwQOgYzYIUuKVWNE", "virtualenv", None),
        ("N5VaKMbgQ0V_BC5tadV65", "pyenv", None),
        ("uh67D1u-Iv5cZamRgFEJg", "conda", None),
        ("IWq-tfkz-pSC1ztZl60vM", "pipenv", None),
        ("uXd2B01GVBEQNXQE8RATT", "poetry", None),
        ("xDgXISgVUMRHh9hu4h6Hl", "pdm", None),
        ("p3Frfs6oxpuciUzeCEsvb", "uv", None),
        ("GHKAY9gOykEbxkEeR30wL", "pyproject.toml", None),
        ("_94NrQ3quc4t_PPOsFSN0", "Common Packages", None),
    ]),
    ("code-quality", "Code Quality", "Typing, formatting, testing, and documentation.", [
        ("1PXApuUpPmJjgi12cmWo4", "Static Typing", "Typing"),
        ("o1wi39VnjnFfWIC8XcuAK", "typing module", "Typing"),
        ("gIcJ3bUVQXqO1Wx4gUKd5", "mypy", "Typing"),
        ("1q9HWgu9jDTK757hTNOmE", "pyright", "Typing"),
        ("9mFR_ueXbIB2IrkqU2s85", "pyre", "Typing"),
        ("l7k0qTYe42wYBTlT2-1cy", "Custom Type Checkers", "Typing"),
        ("0F0ppU_ClIUKZ23Q6BVZp", "Code Formatting", "Formatting"),
        ("DS6nuAUhUYcqiJDmQisKM", "black", "Formatting"),
        ("tsh_vbhzKz1-H9Vh69tsK", "yapf", "Formatting"),
        ("6cB0pvUO1-gvCtgqozP-Q", "ruff", "Formatting"),
        ("WQOYjuwKIWB2meea4JnsV", "Testing", "Testing"),
        ("3FDwJpesfelEyJrNWtm0V", "pytest", "Testing"),
        ("b4he_RO17C3ScNeUd6v2b", "unittest / PyUnit", "Testing"),
        ("aVclygxoA9ePU5IxaORSH", "doctest", "Testing"),
        ("jPFOiwbqfaGshaGDBWb5x", "tox", "Testing"),
        ("maYNuTKYyZndxk1z29-UY", "Sphinx", "Documentation"),
    ]),
    ("concurrency-async", "Concurrency & Async", "Threads, processes, the GIL, and asynchronous Python.", [
        ("u4nRzWQ4zhDFMOrZ2I_uJ", "Concurrency", None),
        ("UIx0XYaOgXXlYbbQtjiPq", "Threading", None),
        ("HSY5OUc_M5S6OcFXPRtkx", "Multiprocessing", None),
        ("bS7WeVKm2kEElu3sBKcIC", "The GIL", None),
        ("Mow7RvropbC4ZGDpcGZmw", "Asynchrony (asyncio)", None),
        ("InUJIGmTnf0X4cSoLuCEQ", "gevent", None),
    ]),
    ("web-frameworks", "Web Frameworks", "The major Python web frameworks and data validation.", [
        ("0-ShORjGnQlAdcwjtxdEB", "Learn a Framework", None),
        ("W3VALz5evFo1qqkQbMN1R", "Pydantic", None),
        ("x1V8GjdjANTnhP6YXMbgC", "Django", None),
        ("HKsGyRzntjh1UbRZSWh_4", "Flask", None),
        ("XeQSmvAsGSTi8dd7QVHxn", "FastAPI", None),
        ("DHtskqATeAVKgaazdhXKD", "Pyramid", None),
        ("9RGpqsj9jHz0_-r7EvRcw", "Sanic", None),
        ("zey2C6BdzsHJAlb_K3qrP", "Tornado", None),
        ("IBVAvFtN4mnIPbIuyUvEb", "aiohttp", None),
        ("7zcpXN3krnS3tMRWVNIVe", "Plotly Dash", None),
    ]),
]

SECTIONS = SECTIONS_PYTHON if COURSE == 'python' else SECTIONS_AI

os.makedirs(OUT, exist_ok=True)
files = {f.rsplit('@', 1)[1][:-3]: f for f in os.listdir(CONTENT)}
manifest = []
total = 0
for idx, (sid, title, desc, topics) in enumerate(SECTIONS, 1):
    bundle = [f"SECTION {idx}: {title}\nDESCRIPTION: {desc}\n{'='*70}\n"]
    tlist = []
    for nid, ttitle, sub in topics:
        slug = re.sub(r'[^a-z0-9]+', '-', ttitle.lower()).strip('-')
        tlist.append({"id": slug, "nodeId": nid, "title": ttitle, "subsection": sub})
        bundle.append(f"\n### TOPIC: {ttitle}  (id: {slug})  [group: {sub or '-'}]\n")
        if nid in files:
            with open(os.path.join(CONTENT, files[nid])) as f:
                bundle.append(f.read())
        else:
            bundle.append("(no roadmap.sh content file — author this topic from your own knowledge; "
                          "include 2-3 high-quality official-doc resource links you are confident exist)")
        bundle.append("\n" + "-"*70)
        total += 1
    with open(os.path.join(OUT, f"{idx:02d}-{sid}.txt"), 'w') as f:
        f.write("\n".join(bundle))
    manifest.append({"index": idx, "id": sid, "title": title, "description": desc, "topics": tlist})

with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
print(f"{len(manifest)} sections, {total} topics")

---
name: hyperspace-lan-sharding
description: Use Hyperspace to automatically cluster and shard AI models across multiple devices on the same LAN for distributed inference.
---

# Hyperspace LAN Sharding

When the user requests to cluster devices on a LAN or shard inference to boost tokens-per-second, use the Hyperspace CLI's built-in clustering features rather than manually configuring `llama.cpp` RPC.

## Prerequisites
- Ensure the Hyperspace CLI is installed (`hyperspace --version`).
- Note: On Windows, Hyperspace currently requires WSL2 (Ubuntu).

## Commands for Distributed Inference

### 1. Zero-Config LAN Pod (Exo-style)
To automatically discover and pool VRAM across all devices on the same WiFi/LAN:
```bash
hyperspace lan-pod start
```
This command automatically negotiates VRAM limits, downloads the requested model in shards, and distributes the tensor layers across all nodes on the local network.

### 2. Private Swarm Inference
To split models across specific P2P nodes (even over the internet or VPN):
```bash
hyperspace swarm-infer --model <model_name>
```

### 3. Creating a Managed Pod
To create a persistent, secure cluster with specific trusted peers (pools hardware, models, and API credits):
```bash
hyperspace pod create "my-cluster"
hyperspace pod invite  # Run this on the master node to get an invite link
hyperspace pod join <link>  # Run this on the worker nodes
```

## Integration with KLYDIS
When integrating this into KLYDIS's backend:
1. Detect if the user is on an OS that natively supports Hyperspace daemon (Linux/macOS). If on Windows, inform the user that it must be run under WSL2.
2. Use `subprocess.Popen` to launch `hyperspace lan-pod start` or `hyperspace start --auto-model` in the background.
3. Point KLYDIS's chat completion endpoint to `http://localhost:8080/v1` (Hyperspace's default API port).

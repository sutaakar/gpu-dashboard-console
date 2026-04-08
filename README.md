# GPU Workload Dashboard - OpenShift Console Plugin

An OpenShift Console dynamic plugin that provides a real-time GPU workload dashboard. It visualizes GPU allocation, utilization, and memory usage across cluster nodes, with workloads grouped by [Kueue](https://kueue.sigs.k8s.io/) ClusterQueues.

![License](https://img.shields.io/badge/license-Apache%202.0-blue)

## Features

- **Per-node GPU cards** showing capacity, allocation, and availability at a glance
- **Proportional bar chart** visualizing GPU allocation per workload, grouped by Kueue ClusterQueue
- **Live GPU metrics** (utilization and memory) via Prometheus/DCGM integration
- **Owner resolution** - walks Kubernetes owner references to display top-level resources (Deployments, StatefulSets, Jobs, etc.) instead of individual pods
- **Clickable workloads** with detail panel linking directly to the resource in the OpenShift Console
- **Failing pod detection** - highlights workloads in error states (CrashLoopBackOff, ImagePullBackOff, etc.)
- **Configurable refresh interval** (15s to 1h, or off)

## Prerequisites

- OpenShift 4.x cluster with console dynamic plugin support
- NVIDIA GPU Operator installed (nodes reporting `nvidia.com/gpu` resources)
- [NVIDIA DCGM Exporter](https://github.com/NVIDIA/dcgm-exporter) for GPU utilization and memory metrics (optional, but recommended)
- [Kueue](https://kueue.sigs.k8s.io/) for ClusterQueue grouping (optional)

## Getting Started

### Development

```bash
# Install dependencies
npm ci

# Start the development server (port 9001)
npm start

# Build for production
npm run build
```

When running the dev server, configure the OpenShift Console to load the plugin from `http://localhost:9001`.

### Building the Container Image

```bash
podman build -t gpu-workload-treemap .
```

The image uses a multi-stage build:
1. **Build stage** - Node.js 18 on UBI9 compiles the TypeScript/Webpack bundle
2. **Runtime stage** - Nginx on UBI9 serves the static plugin assets over TLS (port 9443)

### Deploying to OpenShift

Apply the deployment manifests:

```bash
# Set your plugin image
export PLUGIN_IMAGE=quay.io/yourorg/gpu-workload-treemap:latest

# Deploy the plugin
envsubst < manifests/template.yaml | oc apply -f -
```

This creates:
- A `gpu-workload-treemap` Namespace
- A Deployment running the Nginx-based plugin server
- A Service with a serving certificate for TLS
- A `ConsolePlugin` CR that registers the plugin with the OpenShift Console

After deploying, enable the plugin in the OpenShift Console under **Administration > Cluster Settings > Configuration > Console operator > Console plugins**.

## Usage

Once enabled, the plugin adds a **GPU Workloads** entry under the **Observe** section in the admin perspective navigation. The dashboard shows:

- One card per GPU-equipped worker node
- GPU allocation, compute utilization, and memory usage progress bars
- A proportional bar chart where each bar represents a workload, sized by the number of GPUs it consumes
- Workloads grouped and color-coded by their Kueue ClusterQueue assignment
- Click any workload bar to see details and a direct link to the resource

## Project Structure

```
.
├── console-extensions.json   # Console plugin extension points (nav + route)
├── Dockerfile                # Multi-stage container build
├── manifests/
│   └── template.yaml         # OpenShift deployment manifests
├── nginx.conf                # Nginx config for serving the plugin
├── src/
│   ├── components/
│   │   ├── GpuNodesPage.tsx  # Main page component with toolbar and node grid
│   │   ├── GpuNodeCard.tsx   # Per-node card with stats, bars, and detail panel
│   │   └── gpu-node-card.css # Component styles
│   ├── hooks/
│   │   └── useGpuNodeData.ts # K8s watch + Prometheus data hook
│   └── utils/
│       └── gpu-utils.ts      # Models, types, owner traversal, pod utilities
├── webpack.config.js         # Webpack config with ConsoleRemotePlugin
└── tsconfig.json
```

## License

[Apache License 2.0](LICENSE)

FROM oven/bun:1 AS base
WORKDIR /app

# Install system dependencies.
# OpenSCAD is NOT bundled — it is invoked as an external CLI via OPENSCAD_BIN.
# Users who need rendering must install OpenSCAD separately.
RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Install Python mesh validation dependencies
RUN python3 -m pip install --break-system-packages trimesh numpy scipy rtree

# Copy package files
COPY package.json bun.lock* ./

# Install Node dependencies
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

# Generate Prisma client
RUN bun run db:generate

# Build Next.js
RUN bun run build

# Run as non-root user (bun user exists in oven/bun base image, uid 1000)
USER bun

EXPOSE 3000

CMD ["bun", "run", "start"]

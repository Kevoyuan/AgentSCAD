#!/usr/bin/env python3
"""Independent diagnostic on frozen identity-placed meshes, using standard Python."""
import collections
import hashlib
import json
import math
from pathlib import Path
import struct
import sys


def digest(data):
    return hashlib.sha256(data).hexdigest()


def subtract(a, b):
    return tuple(x-y for x, y in zip(a, b))


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def inspect_mesh(file, points):
    data = Path(file).read_bytes()
    count = struct.unpack_from('<I', data, 80)[0]
    assert count and len(data) == 84+50*count
    triangles, adjacency = [], collections.defaultdict(set)
    edges, orientation = collections.Counter(), collections.Counter()
    for index in range(count):
        values = struct.unpack_from('<9f', data, 84+50*index+12)
        assert all(math.isfinite(value) for value in values)
        triangle = [tuple(values[j:j+3]) for j in (0, 3, 6)]
        normal = cross(subtract(triangle[1], triangle[0]), subtract(triangle[2], triangle[0]))
        assert dot(normal, normal) > 0
        triangles.append(triangle)
        for j in range(3):
            a, b = triangle[j], triangle[(j+1) % 3]
            adjacency[a].add(b)
            adjacency[b].add(a)
            edge = tuple(sorted((a, b)))
            edges[edge] += 1
            orientation[edge] += 1 if a < b else -1
    assert all(edges[edge] == 2 and orientation[edge] == 0 for edge in edges)
    remaining, components = set(adjacency), []
    while remaining:
        vertices = [remaining.pop()]
        pending = list(vertices)
        while pending:
            for vertex in adjacency[pending.pop()]:
                if vertex in remaining:
                    remaining.remove(vertex)
                    pending.append(vertex)
                    vertices.append(vertex)
        components.append({'min': [min(v[k] for v in vertices) for k in range(3)],
                           'max': [max(v[k] for v in vertices) for k in range(3)]})
    gaps = []
    for axis in range(3):
        intervals = sorted((box['min'][axis], box['max'][axis]) for box in components)
        upper = intervals[0][1]
        for lower, end in intervals[1:]:
            if lower > upper:
                gaps.append({'axis': axis, 'lower': upper, 'upper': lower, 'gapMm': lower-upper})
            upper = max(upper, end)
    samples = []
    for point in points:
        angle = 0
        for triangle in triangles:
            a, b, c = [subtract(vertex, point) for vertex in triangle]
            la, lb, lc = [math.sqrt(dot(v, v)) for v in (a, b, c)]
            assert min(la, lb, lc) > 0
            angle += 2*math.atan2(dot(a, cross(b, c)), la*lb*lc+dot(a, b)*lc+dot(b, c)*la+dot(c, a)*lb)
        winding = angle/(4*math.pi)
        classification = 'INSIDE' if abs(abs(winding)-1) < 1e-6 else 'OUTSIDE' if abs(winding) < 1e-6 else 'UNDECIDED'
        samples.append({'pointMm': point, 'winding': winding, 'classification': classification})
    return {'sha256': digest(data), 'triangles': count, 'components': components, 'separatingSlabs': gaps, 'samples': samples}


def main():
    protocol_bytes = Path(sys.argv[1]).read_bytes()
    protocol = json.loads(protocol_bytes)
    rows = []
    for case in protocol['cases']:
        source = Path(case['sourcePath']).read_bytes()
        assert digest(source) == case['sourceSha256']
        declaration = json.loads(source.decode().split('/* AGENTSCAD_ASSEMBLY_V1', 1)[1].split('END_AGENTSCAD_ASSEMBLY */', 1)[0])
        assert all(instance['transform'] == [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] for instance in declaration['instances'])
        parts = {}
        for part_id, artifact in case['parts'].items():
            assert digest(Path(artifact['path']).read_bytes()) == artifact['sha256']
            parts[part_id] = inspect_mesh(artifact['path'], protocol['pointsMm'])
        rows.append({'case': case['id'], 'parts': parts})
    print(json.dumps({'method': 'independent-oriented-edge-components-and-solid-angle/v1',
                      'protocolSha256': digest(protocol_bytes), 'scriptSha256': digest(Path(__file__).read_bytes()),
                      'coverage': 'Frozen Float32 meshes at identity pose. Closed edge accounting and double precision winding samples. No full self-intersection, continuous path, material compliance or physical certificate.',
                      'results': rows, 'physical': 'NOT_RUN'}, indent=2))


if __name__ == '__main__':
    main()

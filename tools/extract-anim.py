#!/usr/bin/env python3
"""Extrai SÓ a animação de um GLB, descartando malha/textura/skin.

Motivo: o `3d_rigging` do provedor devolve o clipe pedido junto com uma malha
DECIMADA (20 662 → 400 triângulos, inutilizável). A malha boa vem do
`image_to_3d`; daqui só interessa a animação. Como os dois arquivos saem do mesmo
modelo, os ossos têm nomes idênticos e as faixas casam por nome no three.js.

Resultado típico: 2,5 MB → ~28 KB.

Uso: python3 extract-anim.py entrada.glb saida.glb
"""
import json
import struct
import sys


def read_glb(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF', 'não é um GLB'
    off, js, binc = 12, None, None
    while off < len(d):
        clen, ctype = struct.unpack('<II', d[off:off + 8])
        chunk = d[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
    return js, binc, len(d)


def extract(src, out, index=0):
    js, binc, size_in = read_glb(src)
    anim = js['animations'][index]

    # Só os accessors que as faixas usam (tempos + valores).
    keep = sorted({s['input'] for s in anim['samplers']} | {s['output'] for s in anim['samplers']})
    remap = {old: i for i, old in enumerate(keep)}

    new_bin = bytearray()
    views, accs = [], []
    for old in keep:
        acc = dict(js['accessors'][old])
        bv = js['bufferViews'][acc['bufferView']]
        start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        comp = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[acc['type']]
        nbytes = acc['count'] * comp * 4
        while len(new_bin) % 4:
            new_bin.append(0)
        views.append({'buffer': 0, 'byteOffset': len(new_bin), 'byteLength': nbytes})
        new_bin += binc[start:start + nbytes]
        acc['bufferView'] = len(views) - 1
        acc.pop('byteOffset', None)
        accs.append(acc)

    for s in anim['samplers']:
        s['input'] = remap[s['input']]
        s['output'] = remap[s['output']]

    # Nós sem malha/skin: só o esqueleto, para as faixas resolverem por nome.
    nodes = [{k: v for k, v in n.items() if k not in ('mesh', 'skin', 'camera')} for n in js['nodes']]

    doc = {
        'asset': {'version': '2.0', 'generator': 'extract-anim'},
        'scene': js.get('scene', 0),
        'scenes': js['scenes'],
        'nodes': nodes,
        'animations': [anim],
        'accessors': accs,
        'bufferViews': views,
        'buffers': [{'byteLength': len(new_bin)}],
    }
    jb = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    while len(jb) % 4:
        jb += b' '
    while len(new_bin) % 4:
        new_bin.append(0)

    glb = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(new_bin))
    glb += struct.pack('<II', len(jb), 0x4E4F534A) + jb
    glb += struct.pack('<II', len(new_bin), 0x004E4942) + bytes(new_bin)
    open(out, 'wb').write(glb)
    print(f"{out}: {len(glb)/1024:.0f} KB  (entrada {size_in/1024/1024:.1f} MB)  clipe '{anim.get('name')}'")


if __name__ == '__main__':
    extract(sys.argv[1], sys.argv[2])

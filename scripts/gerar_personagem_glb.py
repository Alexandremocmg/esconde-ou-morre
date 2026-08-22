"""Gera public/models/character_animated.glb a partir dos FBX do Mixamo.

Roda DENTRO do Blender (testado no 5.2 LTS):

    blender --background --python scripts/gerar_personagem_glb.py

Cada FBX do Mixamo traz uma cópia COMPLETA da malha (204.344 faces) só para
entregar um clipe de animação. Este script junta tudo em UMA malha + UM
esqueleto com os 7 clipes, decima a malha e exporta um único GLB.

Resultado: 47MB em 7 arquivos  ->  1,43MB em um; 204.344 faces -> 12.000.
"""

import json
import os

import bmesh
import bpy

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(RAIZ, "public", "animation")
SAIDA = os.path.join(RAIZ, "public", "models", "character_animated.glb")

ALVO_FACES = 12000
OSSO_RAIZ = "Hips"          # casa com "mixamorig:Hips"

# A malha nasceu no Tripo3D (nome do mesh: "tripo_node_..."), e sua UV vem
# espalhada pelo espaço 0-1 inteiro por parte do corpo — cabeça, tronco e
# braço praticamente se sobrepõem (medido: Head U[0.01,0.77]V[0.04,0.89],
# Spine2 U[0.00,0.81]V[0.00,0.99], LeftArm U[0.01,0.91]V[0.10,1.00]).
# Inviabiliza pintar só uma região sem manchar as outras — ver
# docs/PLANO_MULTIPLAYER.md não, ver o plano de pintura 3D (sistema de
# camuflagem por UV). REGIOES_CORPO decide, por osso dominante de peso de
# skin, em qual ilha de UV cada face cai.
REGIOES_CORPO = ("head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg")

# Grade 3x2 fixa no espaço 0-1: cada região ganha sua própria célula
# (u0, v0, largura, altura). Precisa ser fixa — deixar o `pack_islands` do
# Blender decidir o layout final ignora a noção de "região" (ele só enxerga
# ilhas de UV soltas) e mistura tudo de volta.
GRADE_UV = {
    "head":     (0 / 3, 1 / 2, 1 / 3, 1 / 2),
    "torso":    (1 / 3, 1 / 2, 1 / 3, 1 / 2),
    "leftArm":  (2 / 3, 1 / 2, 1 / 3, 1 / 2),
    "rightArm": (0 / 3, 0 / 2, 1 / 3, 1 / 2),
    "leftLeg":  (1 / 3, 0 / 2, 1 / 3, 1 / 2),
    "rightLeg": (2 / 3, 0 / 2, 1 / 3, 1 / 2),
}


def regiao_do_osso(nome_osso):
    """Classifica um nome de osso Mixamo (ex.: 'mixamorig:LeftForeArm') numa
    região do corpo. Ordem dos testes importa: checa o mais específico
    primeiro (ex.: 'ForeArm' antes de decidir por sufixo 'Arm')."""
    n = nome_osso
    if "Head" in n or n.endswith(":Neck") or n == "Neck":
        return "head"
    if "ForeArm" in n or "Hand" in n or "Shoulder" in n:
        return "leftArm" if "Left" in n else "rightArm"
    if n.endswith("Arm"):
        return "leftArm" if "Left" in n else "rightArm"
    if "UpLeg" in n or n.endswith("Leg") or "Foot" in n or "Toe" in n:
        return "leftLeg" if "Left" in n else "rightLeg"
    if "Hips" in n or "Spine" in n:
        return "torso"
    return None

# O PRIMEIRO arquivo doa a malha e o esqueleto; dos demais só sai o clipe.
FONTES = [
    ("Standing W_Briefcase Idle.fbx", "idle"),
    ("Running.fbx", "run"),
    ("Crouching Idle.fbx", "crouch"),
    ("Sleeping Idle.fbx", "hide"),
    ("Laying Sleeping.fbx", "prone"),
    ("Climbing Up Wall.fbx", "climb"),
    ("Jump.fbx", "jump"),
    # Poses com arma, usadas só pelo Caçador: sem elas ele corre de braços
    # soltos com a arma de água pendurada na mão.
    ("Rifle Run.fbx", "rifleRun"),
    ("Shoot Rifle.fbx", "shoot"),
]

# Quais eixos do osso raiz zerar, por clipe.
#   X/Z: saem sempre — quem posiciona o personagem no mundo é o jogo.
#   Y:   sai só onde a altura é controlada pelo jogo (climb) ou pela física
#        (jump). FICA onde a descida É a própria ação (crouch, prone, hide):
#        zerar ali arruína o clipe — o corpo deita mas fica flutuando.
POLITICA_ROOT_MOTION = {
    "idle":     {"x": True, "y": False, "z": True},
    "run":      {"x": True, "y": False, "z": True},
    "crouch":   {"x": True, "y": False, "z": True},
    "hide":     {"x": True, "y": False, "z": True},
    "prone":    {"x": True, "y": False, "z": True},
    "climb":    {"x": True, "y": True,  "z": True},
    "jump":     {"x": True, "y": True,  "z": True},
    "rifleRun": {"x": True, "y": False, "z": True},
    "shoot":    {"x": True, "y": False, "z": True},
}


def fcurvas(act):
    """Compatível com o layout antigo e com as slotted actions do Blender 4.4+."""
    if len(getattr(act, "fcurves", [])):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, "layers", []):
        for strip in getattr(layer, "strips", []):
            for cb in getattr(strip, "channelbags", []):
                out.extend(cb.fcurves)
    return out


def limpar_cena():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    # O importador FBX marca use_fake_user nas actions: sem zerar isso elas nunca
    # são removidas e a leitura seguinte devolve a ação errada.
    for a in list(bpy.data.actions):
        a.use_fake_user = False
        bpy.data.actions.remove(a)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)


def importar_e_juntar():
    arm = mesh = None
    for arquivo, nome in FONTES:
        caminho = os.path.join(BASE, arquivo)
        if not os.path.exists(caminho):
            raise RuntimeError(f"arquivo ausente: {caminho}")

        antes_a = {a.name for a in bpy.data.actions}
        antes_o = {o.name for o in bpy.data.objects}
        bpy.ops.import_scene.fbx(filepath=caminho)

        novas = [a for a in bpy.data.actions if a.name not in antes_a]
        if not novas:
            raise RuntimeError(f"nenhuma ação importada de {arquivo}")
        novas[0].name = nome
        novas[0].use_fake_user = True   # sobrevive à remoção do objeto importado

        novos = [o for o in bpy.data.objects if o.name not in antes_o]
        if arm is None:
            for o in novos:
                if o.type == "ARMATURE":
                    arm = o
                elif o.type == "MESH":
                    mesh = o
            arm.name = "Armature"
            mesh.name = "Personagem"
        else:
            for o in novos:                     # dos demais só interessa a ação
                bpy.data.objects.remove(o, do_unlink=True)

    for coll in (bpy.data.meshes, bpy.data.armatures):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)
    return arm, mesh


def decimar(mesh):
    faces_antes = len(mesh.data.polygons)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh

    d = mesh.modifiers.new(name="Decimate", type="DECIMATE")
    d.decimate_type = "COLLAPSE"        # COLLAPSE interpola vertex groups (pesos)
    d.ratio = ALVO_FACES / faces_antes
    d.use_collapse_triangulate = True
    # Aplica SÓ o Decimate — aplicar o modifier de Armature quebraria o skinning.
    bpy.ops.object.modifier_apply(modifier="Decimate")

    sem_peso = sum(1 for v in mesh.data.vertices if len(v.groups) == 0)
    if sem_peso:
        raise RuntimeError(f"{sem_peso} vértices ficaram sem peso de skin")
    return faces_antes, len(mesh.data.polygons)


def reunwrap_por_regiao(mesh):
    """Refaz a UV em 6 ilhas não sobrepostas (cabeça/tronco/braço
    esq./braço dir./perna esq./perna dir.), uma por região do corpo, pra
    viabilizar pintura localizada (ver comentário de REGIOES_CORPO acima).
    Roda DEPOIS do decimate — a UV final já casa com a topologia exportada,
    sem risco de o decimate distorcer um unwrap feito antes dele."""
    grupos_idx_para_nome = {vg.index: vg.name for vg in mesh.vertex_groups}

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh

    # Uma única sessão de Edit Mode pro método inteiro — alternar
    # Object/Edit repetidamente dentro do loop (uma vez por região) trava o
    # Blender 5.2 headless com EXCEPTION_ACCESS_VIOLATION em
    # BM_mesh_bm_from_me (bug reproduzido; não é erro deste script).
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")

    bm = bmesh.from_edit_mesh(mesh.data)
    deform_layer = bm.verts.layers.deform.active

    def regiao_do_vert(v):
        dvert = v[deform_layer]
        if not len(dvert):
            return None
        melhor_grupo = max(dvert.keys(), key=lambda k: dvert[k])
        nome = grupos_idx_para_nome.get(melhor_grupo)
        return regiao_do_osso(nome) if nome else None

    def regiao_da_face(f):
        votos = {}
        for v in f.verts:
            r = regiao_do_vert(v)
            if r:
                votos[r] = votos.get(r, 0) + 1
        return max(votos, key=votos.get) if votos else None

    # Reclassifica a cada iteração em vez de reaproveitar um índice de face
    # calculado uma vez: bpy.ops.uv.smart_project pode reordenar a bmesh por
    # baixo, e usar face.index de uma lista externa produzia remapeamento
    # errado (regiões "vazando" célula adentro — bug visto e corrigido).
    # A classificação por peso de skin (via deform_layer) não depende de
    # ordem/índice, então fica correta mesmo se a bmesh for reconstruída.
    relatorio = {}
    INSET = 0.06  # margem dentro de cada célula pra regiões não se tocarem
    for regiao in REGIOES_CORPO:
        bm = bmesh.from_edit_mesh(mesh.data)
        bm.faces.ensure_lookup_table()
        n_faces = 0
        for f in bm.faces:
            sel = regiao_da_face(f) == regiao
            f.select = sel
            if sel:
                n_faces += 1
        bmesh.update_edit_mesh(mesh.data)
        relatorio[regiao] = n_faces
        if n_faces == 0:
            continue

        # smart_project sempre desenha em [0,1]x[0,1] — o remapeamento pra
        # célula da região acontece manualmente logo abaixo, não com
        # pack_islands (que ignora a noção de "região" e mistura tudo de
        # novo, já que só enxerga ilhas soltas de UV).
        bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)

        bm = bmesh.from_edit_mesh(mesh.data)
        bm.faces.ensure_lookup_table()
        uv_layer = bm.loops.layers.uv.active
        u0, v0, cw, ch = GRADE_UV[regiao]
        for f in bm.faces:
            if regiao_da_face(f) != regiao:
                continue
            for loop in f.loops:
                uv = loop[uv_layer].uv
                uv.x = u0 + (INSET + uv.x * (1 - 2 * INSET)) * cw
                uv.y = v0 + (INSET + uv.y * (1 - 2 * INSET)) * ch
        bmesh.update_edit_mesh(mesh.data)

    bm = bmesh.from_edit_mesh(mesh.data)
    bm.faces.ensure_lookup_table()
    relatorio["sem_regiao"] = sum(1 for f in bm.faces if regiao_da_face(f) is None)

    bpy.ops.object.mode_set(mode="OBJECT")
    return relatorio


def remover_root_motion():
    relatorio = {}
    for act in bpy.data.actions:
        politica = POLITICA_ROOT_MOTION.get(act.name)
        if not politica:
            continue
        removido, mantido = {}, {}
        for fc in fcurvas(act):
            if OSSO_RAIZ not in fc.data_path or not fc.data_path.endswith(".location"):
                continue
            eixo = "xyz"[fc.array_index]
            pontos = fc.keyframe_points
            if not len(pontos):
                continue
            amplitude = round(max(p.co[1] for p in pontos) - min(p.co[1] for p in pontos), 2)
            if not politica.get(eixo):
                mantido[eixo] = amplitude
                continue
            base = pontos[0].co[1]
            for p in pontos:
                p.co[1] = base
                p.handle_left[1] = base
                p.handle_right[1] = base
            fc.update()
            removido[eixo] = amplitude
        relatorio[act.name] = {"removido": removido, "mantido": mantido}
    return relatorio


def exportar(arm, mesh):
    # O import do Mixamo deixa o Armature com escala 0.01, o que exportaria um
    # modelo 100x menor. Escala de OBJETO não entra nas f-curves (que são em
    # espaço de osso), então corrigir aqui não mexe nas animações.
    arm.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()

    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = arm

    bpy.ops.export_scene.gltf(
        filepath=SAIDA,
        use_selection=True,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",   # cada action vira uma animação no glTF
        export_bake_animation=True,
        export_optimize_animation_size=True,
        export_apply=False,                # aplicar modifiers quebraria o skinning
        export_skins=True,
        export_yup=True,
        export_materials="NONE",           # o jogo troca por MeshToonMaterial
        export_draco_mesh_compression_enable=False,  # evita DRACOLoader no jogo
    )


if __name__ == "__main__":
    limpar_cena()
    arm, mesh = importar_e_juntar()
    faces = decimar(mesh)
    uv_regioes = reunwrap_por_regiao(mesh)
    root_motion = remover_root_motion()
    exportar(arm, mesh)

    print(json.dumps({
        "saida": SAIDA,
        "mb": round(os.path.getsize(SAIDA) / 1048576, 2),
        "faces": {"antes": faces[0], "depois": faces[1]},
        "clipes": sorted(a.name for a in bpy.data.actions),
        "ossos": len(arm.data.bones),
        "root_motion": root_motion,
        "uv_regioes": uv_regioes,
    }, indent=2, ensure_ascii=False))

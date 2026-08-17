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

import bpy

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(RAIZ, "public", "animation")
SAIDA = os.path.join(RAIZ, "public", "models", "character_animated.glb")

ALVO_FACES = 12000
OSSO_RAIZ = "Hips"          # casa com "mixamorig:Hips"

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
    root_motion = remover_root_motion()
    exportar(arm, mesh)

    print(json.dumps({
        "saida": SAIDA,
        "mb": round(os.path.getsize(SAIDA) / 1048576, 2),
        "faces": {"antes": faces[0], "depois": faces[1]},
        "clipes": sorted(a.name for a in bpy.data.actions),
        "ossos": len(arm.data.bones),
        "root_motion": root_motion,
    }, indent=2, ensure_ascii=False))

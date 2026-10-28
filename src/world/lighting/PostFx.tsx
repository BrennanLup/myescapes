/**
 * The app's ONLY EffectComposer. Order: ambient occlusion and bloom on linear HDR, then AgX
 * tone mapping, then the colour grade, vignette and a whisper of film grain.
 * While mounted, @react-three/postprocessing sets renderer.toneMapping = NoToneMapping,
 * so tone mapping happens exactly once (in the ToneMapping effect).
 */
import { EffectComposer, N8AO, Bloom, ToneMapping, HueSaturation, BrightnessContrast, Vignette, Noise } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import type { PostSpec } from './rig'

export function PostFx({ spec }: { spec: PostSpec }) {
  return (
    <EffectComposer multisampling={spec.multisampling}>
      <N8AO
        enabled={spec.ao.enabled}
        aoRadius={spec.ao.radius}
        intensity={spec.ao.intensity}
        distanceFalloff={spec.ao.distanceFalloff}
        quality={spec.ao.quality}
        halfRes={spec.ao.halfRes}
        depthAwareUpsampling
        color="#1a0f0a"
      />
      <Bloom
        mipmapBlur={spec.bloom.mipmapBlur}
        intensity={spec.bloom.intensity}
        luminanceThreshold={spec.bloom.threshold}
        luminanceSmoothing={spec.bloom.smoothing}
      />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <HueSaturation saturation={spec.grade.saturation} />
      <BrightnessContrast brightness={spec.grade.brightness} contrast={spec.grade.contrast} />
      <Vignette offset={spec.vignette.offset} darkness={spec.vignette.darkness} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={spec.grain} />
    </EffectComposer>
  )
}

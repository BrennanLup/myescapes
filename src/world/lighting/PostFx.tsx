/**
 * The app's ONLY EffectComposer. Order: bloom on linear HDR, then ACES tone mapping, then vignette.
 * While mounted, @react-three/postprocessing sets renderer.toneMapping = NoToneMapping,
 * so tone mapping happens exactly once (in the ToneMapping effect).
 */
import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { PostSpec } from './rig'

export function PostFx({ spec }: { spec: PostSpec }) {
  return (
    <EffectComposer multisampling={spec.multisampling}>
      <Bloom
        mipmapBlur={spec.bloom.mipmapBlur}
        intensity={spec.bloom.intensity}
        luminanceThreshold={spec.bloom.threshold}
        luminanceSmoothing={spec.bloom.smoothing}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={spec.vignette.offset} darkness={spec.vignette.darkness} />
    </EffectComposer>
  )
}

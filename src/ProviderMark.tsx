import type {Candidate} from './model';
import claude from './assets/claude.svg';
import chatgpt from './assets/chatgpt.svg';

export function candidateAuthor(candidate:Pick<Candidate,'origin'|'provider'>){
  return candidate.origin==='human'?'You':candidate.provider==='claude'?'Claude':candidate.provider==='codex'?'Codex':'Earlier suggestion';
}
export function ProviderMark({provider}:{provider:Candidate['provider']}){
  return provider?<img className={`provider-mark provider-${provider}`} src={provider==='claude'?claude:chatgpt} alt="" aria-hidden="true"/>:<span className="option-dot"/>;
}

let context:AudioContext|undefined;
export const comparisonFrequency=(original:boolean)=>original?220:440;
export function playComparisonSound(original:boolean){
  try{
    context??=new AudioContext();
    void context.resume().then(()=>{
      const oscillator=context!.createOscillator(),gain=context!.createGain(),now=context!.currentTime;
      oscillator.type='sine';oscillator.frequency.value=comparisonFrequency(original);
      gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.035,now+.008);gain.gain.exponentialRampToValueAtTime(.001,now+.09);
      oscillator.connect(gain);gain.connect(context!.destination);oscillator.start(now);oscillator.stop(now+.1);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    }).catch(()=>{});
  }catch{/* Sound is optional when audio is unavailable. */}
}

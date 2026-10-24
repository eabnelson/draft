// Studio Four personal-cloud Tabs: same markup, states, and measured geometry.
export function Tabs<T extends string>({label,items,value,onChange}:{
  label:string;
  items:readonly {id:T;label:string;count?:number}[];
  value:T;
  onChange:(value:T)=>void;
}) {
  return <div className="studio-tabs" role="group" aria-label={label}>
    {items.map(item=><button type="button" key={item.id} aria-pressed={value===item.id}
      className={`studio-tab ${value===item.id?'studio-tab-active':''}`} onClick={()=>onChange(item.id)}>
      {item.label}{item.count!==undefined&&<> <span className="pill-count">{item.count}</span></>}
    </button>)}
  </div>;
}

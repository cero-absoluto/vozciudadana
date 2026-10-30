export function publicReportId(id){return typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)?id:'';}
export function reportRouteGuard(to){return to.name==='public-report'&&!publicReportId(to.params?.id)?{path:'/',replace:true}:true;}

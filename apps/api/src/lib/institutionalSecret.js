// Configured keys are unchanged. Weak defaults require an explicit local/test mode.
export function institutionalSecret(name,env=process.env) {
 const value=env[name];
 if(value)return value;
 if(!['development','test'].includes(env.NODE_ENV))throw new Error(name+' is required');
 return undefined;
}

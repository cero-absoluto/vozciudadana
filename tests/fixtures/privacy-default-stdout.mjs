import assert from 'node:assert/strict';
import {bootPrivacyServer,sentinel} from '../helpers/privacy-server-fixture.mjs';
const {app,providerCalls}=await bootPrivacyServer({capture:false});
try {
 app.log.child({credential:sentinel}).warn({code:'otp_provider_max_attempts',body:{token:sentinel}},sentinel);
 for(const request of [{url:'/'+sentinel+'?token='+sentinel},{method:'POST',url:'/api/users/request-otp',payload:{phone:sentinel}},{url:'/health'}]){const response=await app.inject(request);assert.ok(!response.body.includes(sentinel));}
 assert.equal(providerCalls(),0);
}finally{await app.close();}

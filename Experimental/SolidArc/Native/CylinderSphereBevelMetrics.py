"""Native C++ own-pointer selection + bevel transactions on Boolean sphere corners.
Native GLES ID picking (software SwiftShader here); no browser, injected pick
IDs, mesh booleans, or live user session is used.
"""
from pathlib import Path
import json
import os
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[3]


class CylinderSphereBevelMetrics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        env = os.environ.copy()
        env['SOLIDARC_COMMAND_GPU_PICKING']='1'
        env.setdefault('SOLIDARC_GPU_PICKING_LIBRARY_DIR',str(ROOT / '.cache/native-gpu/lib'))
        env['SOLIDARC_OCCT_BLEND_HOST'] = str(ROOT / '.cache/solidarc-occt/BlendHost')
        cls.process = subprocess.Popen([str(ROOT / '_AgentScratch/build/SolidArcNative/GeometryHost')], cwd=ROOT,
                                       env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        cls.cases = []

    @classmethod
    def tearDownClass(cls):
        cls.process.stdin.close()
        cls.process.wait(timeout=10)
        cls.process.stdout.close()
        (ROOT / '_AgentScratch/tmp/CylinderSphereNativeProof.json').write_text(json.dumps(cls.cases, indent=2))

    def request(self, action='command', **values):
        self.process.stdin.write(json.dumps(dict(action=action, width=800, height=600, **values)) + '\n')
        self.process.stdin.flush()
        for line in self.process.stdout:
            if line.startswith('SOLIDARC_PACKET '):
                result = json.loads(line[16:])
                self.assertNotIn('error', result)
                return result
        self.fail('Native process exited')

    def command(self, *commands):
        result = self.request(commands=commands)
        self.assertTrue(result['success'], result.get('lines'))
        return result

    def fixture(self, order=0, edge=1):
        self.request('create')
        packet=self.command('reset','sphere (0,0,0) 1','cylinder (0,0,0) .6 2',
                            'boolean subtract '+('#2 -- #1' if order else '#1 -- #2')+' --select-result',
                            'view iso','view fit','gizmo off','dim off','show cages off','selectmode edge','select none')
        figure=packet['description']['figures'][-1]
        self.assertEqual((figure['faces'],figure['edges'],figure['vertices']),(3,3,2) if order else (3,4,4))
        camera=packet['description']['camera'];camera['pitch']= -.7 if order and edge==2 else .8
        return self.request('render',camera=camera)

    def mouse_edge(self, packet, edge, extend=False):
        draw = next(d for d in packet['frame']['draws'] if d.get('kind') == 'line' and (d.get('pick',0)&0x3fff)==3 and (d.get('pick', 0) >> 16) == edge + 1)
        xyz = draw['positions']; matrix = packet['frame']['view']['ViewClip']
        for fraction in (.5, .35, .65, .2, .8):
            index = min(len(xyz)//3-2, int((len(xyz)//3-1)*fraction))*3
            point = [(xyz[index+i]+xyz[index+3+i])*.5 for i in range(3)]
            clip = [sum(matrix[row+4*k]*point[k] for k in range(3))+matrix[row+12] for row in range(4)]
            u, v = (clip[0]/clip[3]+1)/2, (1+clip[1]/clip[3])/2
            for dx,dy in ((0,0),(-1,0),(1,0),(0,-1),(0,1)):
                x,y=u+dx/800,v+dy/600
                self.request('pointerStart',u=x,v=y,cx=x*800,cy=y*600,button=0,extend=extend)
                picked=self.request('pointerEnd',u=x,v=y,cx=x*800,cy=y*600,button=0,extend=extend)
                if edge in picked['description']['figures'][-1]['pickedEdges']:
                    return picked
        self.fail(f'Native mouse could not select edge {edge}')

    def test_both_orders_rims_modes_native_pointer_history_and_reopen(self):
        for order in (0,1):
            for chamfer in (False,True):
                for edge in (1,2):
                    with self.subTest(order=order,chamfer=chamfer,edge=edge):
                        packet=self.mouse_edge(self.fixture(order,edge),edge)
                        before=packet['description']['figures']
                        self.assertTrue(self.request('bevel',operation=0)['success'])
                        preview=self.request('bevel',operation=1,size=.0375,chamfer=chamfer)
                        self.assertTrue(preview['success'],preview['description']['bevel'])
                        self.assertEqual(preview['description']['figures'],before)
                        result=self.request('bevel',operation=2);self.assertTrue(result['success'])
                        after=result['description']['figures'];self.assertEqual(after[-1]['bevelFeatures'][0]['mode'],'chamfer' if chamfer else 'fillet')
                        saved=self.request('save')['file']
                        self.assertEqual(self.command('undo')['description']['figures'],before)
                        self.assertEqual(self.command('redo')['description']['figures'],after)
                        self.command('reset');opened=self.request('open',text=saved);self.assertTrue(opened['success']);self.assertEqual(opened['description']['figures'],after)
                        self.assertTrue(self.request('bevel',operation=0,owner=3,feature=1)['success'])
                        self.assertFalse(self.request('bevel',operation=1,size=0)['success'])
                        self.assertFalse(self.request('bevel',operation=2)['success']);self.assertEqual(self.request('render')['description']['figures'],after)
                        # Exercise a real size edit where validated. The alternate-order
                        # .03 chamfers expose a separate rational-trim readback limit;
                        # prove safe refusal and recover by changing the same feature's mode.
                        edit=self.request('bevel',operation=1,size=.03,chamfer=chamfer)
                        if order and chamfer:
                            self.assertFalse(edit['success'],edit['description']['bevel'])
                            self.assertFalse(self.request('bevel',operation=2)['success'])
                            self.assertEqual(self.request('render')['description']['figures'],after)
                            self.assertTrue(self.request('bevel',operation=1,size=.0375,chamfer=False)['success'])
                        else:self.assertTrue(edit['success'],edit['description']['bevel'])
                        self.assertTrue(self.request('bevel',operation=2)['success'])
                        edited=self.request('render')['description']['figures'][-1]['bevelFeatures'][0]
                        self.assertEqual(edited['size'],.0375 if order and chamfer else .03)
                        self.assertEqual(edited['mode'],'fillet' if order and chamfer else ('chamfer' if chamfer else 'fillet'))
                        self.cases.append(dict(order=order,edge=edge,mode='chamfer' if chamfer else 'fillet',nativePointer=True,previewAtomic=True,undoRedo=True,saveReopen=True,edit=True,invalidApplyAtomic=True))

    def test_periodic_seams_are_disabled_and_transactional(self):
        for order,seams in ((0,(0,3)),(1,(0,))):
            for edge in seams:
                self.fixture(order)
                selected=self.command(f'select edges #3 {edge}')
                before=selected['description']['figures']
                self.assertFalse(selected['description']['bevel']['available'])
                self.assertIn('seam',selected['description']['bevel']['reason'])
                refused=self.request(commands=[f'beveladd .0375 --mode=fillet --targets=3:e{edge}'])
                self.assertFalse(refused['success']);self.assertEqual(refused['description']['figures'],before)

if __name__=='__main__':
    unittest.main(verbosity=2)

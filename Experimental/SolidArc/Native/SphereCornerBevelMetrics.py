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


class SphereCornerBevelMetrics(unittest.TestCase):
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
        (ROOT / '_AgentScratch/tmp/SphereCornerNativeProof.json').write_text(json.dumps(cls.cases, indent=2))

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

    def fixture(self):
        self.request('create')
        packet = self.command('reset', 'box (0,0,0) (4,3,2)', 'box (2,0,0) (6,3,2)', 'sphere (0,0,0) .75',
                            'boolean subtract #3 -- #1 --select-result', 'hide #2', 'view iso', 'view fit',
                            'gizmo off', 'dim off', 'selectmode edge', 'select none')
        camera=packet['description']['camera'];camera['yaw']=2.356194490192345
        return self.request('render',camera=camera)

    def mouse_edge(self, packet, edge, extend=False):
        draw = next(d for d in packet['frame']['draws'] if d.get('kind') == 'line' and (d.get('pick',0)&0x3fff)==4 and (d.get('pick', 0) >> 16) == edge + 1)
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

    def test_six_edges_both_modes_mouse_preview_commit_history_reopen(self):
        for chamfer in (False, True):
            for edge in range(1, 7):
                with self.subTest(chamfer=chamfer, edge=edge):
                    packet = self.mouse_edge(self.fixture(), edge)
                    before = packet['description']['figures']
                    initial=self.request('bevel', operation=0)
                    self.assertTrue(initial['success'])
                    self.assertTrue(initial['description']['bevel']['valid'],initial['description']['bevel'])
                    preview = self.request('bevel', operation=1, size=.0375, chamfer=chamfer)
                    self.assertTrue(preview['success'], preview['description']['bevel'])
                    self.assertEqual(preview['description']['figures'], before)
                    result = self.request('bevel', operation=2)
                    self.assertTrue(result['success'])
                    after = result['description']['figures']
                    feature = after[-1]['bevelFeatures'][-1]
                    self.assertEqual(feature['mode'], 'chamfer' if chamfer else 'fillet')
                    self.assertAlmostEqual(feature['size'], .0375)
                    saved = self.request('save')['file']
                    self.assertEqual(self.command('undo')['description']['figures'], before)
                    self.assertEqual(self.command('redo')['description']['figures'], after)
                    self.command('reset')
                    reopened = self.request('open', text=saved)
                    self.assertTrue(reopened['success'])
                    self.assertEqual(reopened['description']['figures'], after)
                    self.cases.append(dict(edge=edge, mode=feature['mode'], nativePointer=True,
                                           previewAtomic=True, undoRedo=True, saveReopen=True))

    def test_pair_edit_and_invalid_rollback(self):
        self.fixture()
        self.command('select edges #4 3 2')
        self.request('bevel', operation=0)
        self.assertTrue(self.request('bevel', operation=1, size=.0075)['success'])
        self.assertTrue(self.request('bevel', operation=2)['success'])
        before = self.request('render')['description']['figures']
        self.assertTrue(self.request('bevel', operation=0, owner=4, feature=1)['success'])
        self.assertFalse(self.request('bevel', operation=1, size=0)['success'])
        self.assertFalse(self.request('bevel', operation=2)['success'])
        self.assertEqual(self.request('render')['description']['figures'], before)
        self.assertTrue(self.request('bevel', operation=1, size=.0375)['success'])
        self.assertTrue(self.request('bevel', operation=2)['success'])
        self.assertEqual(self.request('render')['description']['figures'][-1]['bevelFeatures'][0]['size'], .0375)


if __name__ == '__main__':
    unittest.main(verbosity=2)

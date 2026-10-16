"""Exercise freshly compiled C++ geometry and vertex commands, not the retained CPU WASM reference."""
from pathlib import Path
import json
import subprocess
import unittest

Root = Path(__file__).resolve().parents[3]
subprocess.run(['python3', str(Path(__file__).with_name('CompileSequence.py')), '--native'], cwd=Root, check=True)


class GeometryMetrics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.Process = subprocess.Popen([str(Root / '_AgentScratch/build/SolidArcNative/GeometryHost')], cwd=Root,
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

    @classmethod
    def tearDownClass(cls):
        cls.Process.stdin.close()
        cls.Process.wait(timeout=10)
        cls.Process.stdout.close()

    def Exchange(self, Action='render', **Values):
        Request = dict(action=Action, identity=getattr(self, 'Identity', 0), width=800, height=600, **Values)
        self.Process.stdin.write(json.dumps(Request) + '\n')
        self.Process.stdin.flush()
        for Line in self.Process.stdout:
            if Line.startswith('SOLIDARC_PACKET '):
                Response = json.loads(Line[len('SOLIDARC_PACKET '):])
                self.assertNotIn('error', Response)
                return Response
        self.fail('Native command process exited before replying')

    def setUp(self):
        self.Identity = self.Exchange('create')['description']['identity']

    def Command(self, *Values):
        Response = self.Exchange('command', commands=Values)
        self.assertTrue(Response['success'], Values)
        return Response

    def Fender(self):
        text=(Root/'Experimental/SolidArc/public/examples/Fender.arc').read_text()
        return self.Command(*[line.strip() for line in text.splitlines() if line.strip() and not line.startswith('#')])

    def test_fender_profiles_native_sheet_round_trip(self):
        response=self.Fender()
        figures=response['description']['figures']
        self.assertEqual([f['name'] for f in figures],['WheelArch','EngineRail','StartProfile','CrownProfile','EndProfile','Fender'])
        self.assertEqual(figures[-1]['classification'],1)
        self.assertEqual(figures[-1]['kind'],'surface')
        self.assertGreater(figures[-1]['poles'],16)
        saved=self.Exchange('save')['file']
        self.assertIn('--profiles=',saved)
        self.Command('reset')
        loaded=self.Exchange('open',text=saved)
        self.assertTrue(loaded['success'])
        self.assertEqual(loaded['description']['figures'][-1]['poles'],figures[-1]['poles'])
        self.assertEqual(loaded['description']['figures'][-1]['high'],figures[-1]['high'])

    def test_profile_loft_optional_mid_refusals_and_undo(self):
        self.Fender()
        self.Command('loft WheelArch EngineRail --profiles=StartProfile,EndProfile --sheet --name=TwoStations')
        self.assertEqual(len(self.Exchange()['description']['figures']),7)
        self.Command('undo');self.assertEqual(len(self.Exchange()['description']['figures']),6)
        self.Command('redo');self.assertEqual(len(self.Exchange()['description']['figures']),7)
        for flag in ['--profiles=StartProfile,EndProfile,CrownProfile','--profiles=StartProfile','--profiles=StartProfile,CrownProfile,EndProfile --degree=2','--profiles=StartProfile,CrownProfile,EndProfile --loop','--profiles=StartProfile,WheelArch,EndProfile']:
            response=self.Exchange('command',commands=['loft WheelArch EngineRail '+flag])
            self.assertFalse(response['success'],flag)
            self.assertEqual(len(response['description']['figures']),7)

    def test_profile_loft_regenerates_from_all_authored_constraints(self):
        response=self.Fender()
        old=response['description']['figures'][-1]
        self.Command('select #1 #2 #3 #4 #5')
        response=self.Command('transform selected --scale=(1.1,1.1,1.1) --pivot=(0,0,0)')
        new=response['description']['figures'][-1]
        for a,b in zip(old['high'],new['high']):self.assertAlmostEqual(a*1.1,b,places=4)

    def test_continuous_hermite_command_and_incomplete_refusal(self):
        response=self.Command('draw hermite (-3,0) (0,0) (-3,3) (0,3) (3,0) (3,-3) (5,1) (6,1)')
        self.assertEqual(response['description']['figures'][0]['poles'],10)
        response=self.Exchange('command',commands=['draw hermite (-3,0) (0,0) (-3,3) (0,3) (3,0)'])
        self.assertFalse(response['success'])
        self.assertEqual(len(response['description']['figures']),1)

    def test_curve_selection_order_and_native_colours(self):
        self.Command('draw line (-2,0,0) (2,0,0)', 'draw line (-2,0,2) (2,0,2)')
        ids=[f['id'] for f in self.Exchange()['description']['figures']]
        r=self.Command(f'select #{ids[1]}',f'select #{ids[0]} --add')
        self.assertEqual(r['description']['selectionOrder'],ids[::-1])
        self.assertEqual(r['description']['activeSelection'],ids[0])
        self.assertEqual({o['key'] for o in r['description']['selectionOperations']},{'loft','sweep','ruled','bridge'})
        for ident,colour in [(ids[0],[.2,1,.45]),(ids[1],[.25,.6,1])]:
            line=next(d for d in r['frame']['draws'] if d['kind']=='line' and d['pick']==ident and not d['overlay'])
            for a,b in zip(line['tint'],colour):self.assertAlmostEqual(a,b,places=5)
            self.assertEqual(line['selection'][0],0) # do not shader-mix back to orange
        r=self.Command(f'select #{ids[1]} --add')
        self.assertEqual(r['description']['activeSelection'],ids[1])
        self.assertEqual(r['description']['selectionOrder'],ids)
        r=self.Command('select none')
        self.assertEqual(r['description']['selectionOperations'],[])
        self.assertEqual(r['description']['activeSelection'],0)

    def test_curve_operation_eligibility(self):
        self.Command('draw line (0,0) (1,0)','draw line (1,0) (2,1)','select all')
        self.assertIn('join',{o['key'] for o in self.Exchange()['description']['selectionOperations']})
        self.Command('reset','circle (0,0,0) 1','circle (0,0,2) 2','select all')
        self.assertEqual({o['key'] for o in self.Exchange()['description']['selectionOperations']},{'loft','sweep','ruled'})
        self.Command('circle (0,0,4) 1','select all')
        self.assertEqual([o['key'] for o in self.Exchange()['description']['selectionOperations']],['loft'])
        self.Command('box (0,0,0) 1 1 1','select all')
        self.assertEqual(self.Exchange()['description']['selectionOperations'],[])

    def test_cut_exact_curve_and_single_step_undo(self):
        self.Command('draw line (-3,0,0) (3,0,0)')
        before=self.Exchange()['description']['figures']
        self.assertTrue(self.Exchange()['description']['sketchTools']['cut']['enabled'])
        self.assertFalse(self.Exchange()['description']['sketchTools']['trim']['enabled'])
        r=self.Command('cut #1 (0,0,0) --select-result')
        fs=r['description']['figures'];self.assertEqual(len(fs),2)
        self.assertEqual(fs[0]['id'],1);self.assertAlmostEqual(fs[0]['high'][0],0,places=7)
        self.assertAlmostEqual(fs[1]['low'][0],0,places=7);self.assertTrue(all(f['selected'] for f in fs))
        self.assertEqual(self.Command('undo')['description']['figures'],before)
        self.assertEqual(self.Command('redo')['description']['figures'],fs)

    def test_trim_removes_only_clicked_interval(self):
        self.Command('draw line (-3,0,0) (3,0,0)','draw line (-1,-2,0) (-1,2,0)','draw line (1,-2,0) (1,2,0)')
        before=self.Exchange()['description']['figures']
        self.assertTrue(self.Exchange()['description']['sketchTools']['trim']['enabled'])
        r=self.Command('trim #1 (0,0,0) --select-result');fs=r['description']['figures']
        self.assertEqual(len(fs),4);self.assertEqual(fs[1:3],before[1:3])
        pieces=[f for f in fs if f['selected']];self.assertEqual(len(pieces),2)
        self.assertAlmostEqual(pieces[0]['high'][0],-1,places=6);self.assertAlmostEqual(pieces[1]['low'][0],1,places=6)
        self.assertEqual(self.Command('undo')['description']['figures'],before)
        self.assertEqual(self.Command('redo')['description']['figures'],fs)
        path=Root/'_AgentScratch/tmp/NativeSketchTrim.arc'
        self.Command(f'save "{path}"','reset',f'open "{path}"')
        self.assertEqual(self.Exchange()['description']['figures'],fs)

    def test_sketch_tools_refuse_invalid_and_hidden_targets(self):
        self.Command('draw line (-3,0,0) (3,0,0)')
        for command in ['cut #1 (-3,0,0)','trim #1 (0,0,0)','trim #1 (0,0,0) --by=Missing']:
            before=self.Exchange()['description']['figures'];r=self.Exchange('command',commands=[command])
            self.assertFalse(r['success'],command);self.assertEqual(r['description']['figures'],before)
        self.Command('hide #1')
        self.assertFalse(self.Exchange()['description']['sketchTools']['cut']['enabled'])
        r=self.Exchange('command',commands=['cut #1 (0,0,0)']);self.assertFalse(r['success'])

    def test_cut_circle_preserves_exact_arcs_and_detaches_blueprint(self):
        self.Command('circle (0,0,0) 2','cut #1 (0,2,0) --select-result','dim auto')
        fs=self.Exchange()['description']['figures'];self.assertEqual(len(fs),2)
        self.assertTrue(all(f['kind']=='arc' for f in fs))
        self.assertTrue(all(f['classification']==0 for f in fs))
        self.Command('draw line (-3,0,0) (3,0,0)')
        before=self.Exchange()['description']['figures']
        r=self.Exchange('command',commands=['trim #1 (2,0,0)'])
        self.assertFalse(r['success']);self.assertEqual(r['description']['figures'],before)

    def test_screen_sketch_edit_is_canonical_and_misses_are_non_mutating(self):
        self.Command('draw line (-3,0,0) (3,0,0)','view top','view fit')
        before=self.Exchange()['description']['figures'];frame=self.Exchange()['frame']
        m=frame['view']['ViewClip'];q=[m[k+12] for k in range(4)]
        u=(q[0]/q[3]+1)/2;v=(q[1]/q[3]+1)/2
        r=self.Exchange('sketchEdit',tool='cut',u=u,v=v)
        self.assertTrue(r['success']);self.assertTrue(r['dirty']);self.assertEqual(len(r['description']['figures']),2)
        fs=r['description']['figures'];self.assertEqual(self.Command('undo')['description']['figures'],before)
        self.Command('redo');path=Root/'_AgentScratch/tmp/NativeSketchCut.arc'
        self.Command(f'save "{path}"','reset','view front',f'open "{path}"')
        self.assertEqual(self.Exchange()['description']['figures'],fs)
        r=self.Exchange('sketchEdit',tool='cut',u=-.1,v=.5);self.assertFalse(r['success']);self.assertEqual(r['description']['figures'],fs)

    def test_coplanar_closed_loft_is_disabled_and_atomic(self):
        self.Command('circle (0,0,0) 2','circle (0,0,0) 1','select all')
        before=self.Exchange()['description']['figures']
        op=next(o for o in self.Exchange()['description']['selectionOperations'] if o['key']=='loft')
        self.assertFalse(op['enabled']);self.assertIn('same plane',op['hint'])
        result=self.Exchange('command',commands=['loft selected'])
        self.assertFalse(result['success']);self.assertEqual(result['description']['figures'],before)
        result=self.Command('loft selected --sheet')
        self.assertEqual(result['description']['figures'][-1]['classification'],1)

    def test_loft_eligibility_checks_actual_plane_not_z(self):
        for normal, centre, displacement in [('(1,0,0)','(0,1,0)','(1,0,0)'),
                                               ('(0,1,0)','(1,0,0)','(0,1,0)'),
                                               ('(1,1,1)','(1,-1,0)','(1,1,1)')]:
            self.Command('reset',f'circle (0,0,0) 2 --normal={normal}',f'circle {centre} 1 --normal={normal}','select all')
            op=next(o for o in self.Exchange()['description']['selectionOperations'] if o['key']=='loft')
            self.assertFalse(op['enabled'],normal)
            self.Command(f'move #2 {displacement}')
            op=next(o for o in self.Exchange()['description']['selectionOperations'] if o['key']=='loft')
            self.assertTrue(op['enabled'],normal)

    def test_coplanar_open_profiles_keep_sheet_loft_enabled(self):
        self.Command('draw line (0,0,0) (2,0,0)','draw line (0,1,0) (2,1,0)','select all')
        op=next(o for o in self.Exchange()['description']['selectionOperations'] if o['key']=='loft')
        self.assertTrue(op['enabled'])
        result=self.Command('loft selected')
        self.assertEqual(result['description']['figures'][-1]['classification'],1)

    def test_selection_order_survives_save_reopen(self):
        self.Command('draw line (0,0) (1,0)','draw line (0,2) (1,2)','select #2','select #1 --add')
        before=self.Exchange()['description']
        saved=self.Exchange('save')['file']
        reopened=self.Exchange('open',text=saved)
        self.assertTrue(reopened['success'])
        self.assertEqual(reopened['description']['selectionOrder'],before['selectionOrder'])
        self.assertEqual(reopened['description']['activeSelection'],before['activeSelection'])

    def test_loft_selected_order_and_undo(self):
        self.Command('circle (0,0,0) 1 --name=Bottom','circle (0,0,3) .6 --name=Top','select Top','select Bottom --add')
        selected=self.Exchange()['description']['selectionOrder']
        r=self.Command('loft selected --degree=2 --select-result')
        loft=r['description']['figures'][-1]
        self.assertEqual(loft['classification'],2)
        self.assertGreater(loft['faces'],0)
        self.assertEqual(r['description']['activeSelection'],loft['id'])
        self.assertEqual(len(self.Command('undo')['description']['figures']),2)
        self.assertEqual(self.Exchange()['description']['selectionOrder'],selected)
        self.assertEqual(len(self.Command('redo')['description']['figures']),3)
        self.Command('reset','draw line (-2,0,0) (2,0,0)','draw line (-2,1,2) (2,1,2)','select all')
        r=self.Command('loft selected --sheet')
        self.assertIn(r['description']['figures'][-1]['classification'],[1,2])

    def test_face_extrusion_normal_individual_and_undo(self):
        self.Command('box (0,0,0) 2 2 2','select faces #1 1')
        before=self.Exchange()['description']['figures']
        x=self.Exchange()['description']['faceExtrusion']
        self.assertTrue(x['available']);self.assertTrue(x['normal']);self.assertEqual(x['count'],1)
        r=self.Command('extrudefaces selected .5 --mode=normal')
        f=r['description']['figures'][0]
        self.assertEqual(f['id'],before[0]['id']);self.assertEqual(f['high'],[2,2,2.5]);self.assertGreater(f['faces'],6)
        self.assertEqual(self.Command('undo')['description']['figures'],before)
        self.assertEqual(self.Command('redo')['description']['figures'][0]['high'],[2,2,2.5])
        self.Command('undo','select faces #1 1 3')
        self.assertFalse(self.Exchange()['description']['faceExtrusion']['normal'])
        failed=self.Exchange('command',commands=['extrudefaces selected .5 --mode=normal'])
        self.assertFalse(failed['success']);self.assertEqual(failed['description']['figures'][0]['high'],[2,2,2])
        r=self.Command('extrudefaces selected .5 --mode=individual')
        self.assertEqual(r['description']['figures'][0]['high'],[2,2.5,2.5])

    def test_face_extrusion_batch_is_atomic_and_preserves_parallel_bodies(self):
        self.Command('box (0,0,0) 2 2 2','box (4,0,0) 2 2 2','select faces #1 1','select faces #2 1 --add')
        before=self.Exchange()['description']['figures']
        r=self.Command('extrudefaces selected .25 --mode=normal')
        self.assertEqual([f['high'][2] for f in r['description']['figures']],[2.25,2.25])
        self.assertEqual(self.Command('undo')['description']['figures'],before)
        for cmd in ['extrudefaces #1:f1 #2:f999 .5','extrudefaces #1:f1 #2:f3 .5 --mode=normal','extrudefaces #1:f1 #1:f1 .5','extrudefaces #1:f1 0','extrudefaces #1:f1 -.5','extrudefaces #1:f1 nan','extrudefaces #1:f1 .5 --mode=bad']:
            r=self.Exchange('command',commands=[cmd]);self.assertFalse(r['success'],cmd);self.assertEqual(r['description']['figures'],before)

    def test_extrusion_shortcut_is_non_mutating_and_result_reopens(self):
        self.Command('box (0,0,0) 2 2 2','select faces #1 1')
        before=self.Exchange()['description']['figures']
        self.assertEqual(self.Command('key e')['description']['figures'],before)
        r=self.Command('extrudefaces #1:f1 .5 --mode=normal')
        expected=r['description']['figures']
        path=Root/'_AgentScratch/tmp/NativeFaceExtrude.arc'
        self.Command(f'save "{path}"','reset',f'open "{path}"')
        self.assertEqual(self.Exchange()['description']['figures'],expected)
        self.assertTrue(self.Exchange()['description']['faceExtrusion']['available'])
        self.Command('reset','box (0,0,0) 2 2 2','sphere (5,0,0) 1')
        before=self.Exchange()['description']['figures']
        # The first body can extrude; the second is unsupported. Neither may change.
        r=self.Exchange('command',commands=['extrudefaces #1:f1 #2:f0 .5 --mode=individual'])
        self.assertFalse(r['success']);self.assertEqual(r['description']['figures'],before)

    def test_connected_coplanar_region_extrusion_has_no_internal_walls(self):
        self.Command('plane (0,0,0) 2 2','plane (0,0,2) 1 2','plane (1,0,2) 1 2',
                     'plane (0,0,0) 2 2 --u=(1,0,0) --v=(0,0,1)',
                     'plane (0,2,0) 2 2 --u=(1,0,0) --v=(0,0,1)',
                     'plane (0,0,0) 2 2 --u=(0,1,0) --v=(0,0,1)',
                     'plane (2,0,0) 2 2 --u=(0,1,0) --v=(0,0,1)',
                     'select all','sew selected --split-junctions --name=SplitCap')
        f=self.Exchange()['description']['figures'][-1];self.assertEqual(f['faces'],7)
        self.Command('select none',f"select faces #{f['id']} 1 2")
        r=self.Command(f"extrudefaces #{f['id']}:f1 #{f['id']}:f2 .5 --mode=normal")
        f=r['description']['figures'][-1];self.assertEqual(f['high'],[2,2,2.5])
        self.assertEqual(f['faces'],13) # 6 split boundary edges, not the 8 per-face walls

    def test_modal_draw_is_atomic_and_undoable(self):
        Before = self.Exchange()['description']
        Failed = self.Exchange('command', commands=['draw rect (1,2)'])
        self.assertFalse(Failed['success'])
        self.assertEqual(Failed['description']['figures'], Before['figures'])
        After = self.Command('draw rect (1,2) (4,6)')['description']
        self.assertEqual(After['figures'][0]['low'], [1,2,0])
        self.assertEqual(After['figures'][0]['high'], [4,6,0])
        self.assertEqual(len(After['history']), 1)
        self.assertFalse(self.Command('undo')['description']['figures'])
        self.assertEqual(len(self.Command('redo')['description']['figures']), 1)

    def test_modal_shapes_and_workplanes(self):
        Cases = ['line (1,2) (3,4)', 'polyline (0,0) (1,0) (1,2) --closed',
                 'centerrect (2,2) (3,4)', 'circle (2,3) (4,3)', 'circle2 (1,2) (3,4)',
                 'arc (0,0) (1,0) (0,1)', 'ellipse (0,0) (2,0) (0,1)',
                 'slot (0,0) (2,0) (2,0.3)', 'polygon (0,0) (2,0) --sides=7',
                 'spline (0,0) (1,2) (3,1)', 'cpcurve (0,0) (1,2) (3,1)']
        for Case in Cases:
            with self.subTest(Case=Case):
                self.Command('reset')
                Result = self.Command('draw '+Case)
                self.assertEqual(len(Result['description']['figures']), 1)
                Saved = self.Exchange('save')['file']
                Reopened = self.Exchange('open', text=Saved)
                self.assertTrue(Reopened['success'])
                self.assertEqual(Reopened['description']['figures'], Result['description']['figures'])
        self.Command('reset', 'workplane xz --origin=(0,2,0)', 'draw circle (0,0) (1,0)')
        Figure = self.Exchange()['description']['figures'][0]
        self.assertAlmostEqual(Figure['low'][1], 2)
        self.assertAlmostEqual(Figure['high'][1], 2)

    def test_shape_kind_survives_rename_undo_and_reopen(self):
        Cases = [('circle3', '(1,0) (0,1) (-1,0)'), ('arc3', '(-1,0) (1,0) (0,1)'),
                 ('pslot', '(0,0) (2,0) (2,2) --radius=.3'),
                 ('sketch-point', '(1,2)'), ('datum-point', '(3,4)')]
        for Kind, Points in Cases:
            with self.subTest(kind=Kind):
                self.Command('reset')
                R = self.Command('draw '+Kind+' '+Points)
                F = R['description']['figures'][0]
                self.assertEqual(F['kind'], Kind)
                self.Command('rename '+str(F['id'])+' Renamed')
                self.assertEqual(self.Exchange()['description']['figures'][0]['kind'], Kind)
                Saved = self.Exchange('save')['file']
                Reopened = self.Exchange('open', text=Saved)
                self.assertTrue(Reopened['success'])
                self.assertEqual(Reopened['description']['figures'][0]['kind'], Kind)
                self.Command('undo')
                self.assertEqual(self.Exchange()['description']['figures'][0]['kind'], Kind)

    def test_background_snapshot_has_no_render_packet(self):
        self.Command('draw circle (1,2) (3,2)')
        Snapshot = self.Exchange('snapshot')
        self.assertTrue(Snapshot['success'])
        self.assertIn('draw circle', Snapshot['file'])
        self.assertNotIn('frame', Snapshot)
        self.assertNotIn('description', Snapshot)
        self.assertEqual(len(self.Exchange()['description']['figures']), 1)

    def test_native_tool_spatial_dimension_strokes(self):
        self.Command('tool rect', 'point (1,2)')
        Response = self.Command('pointer 480 360 --ctrl')
        self.assertEqual(Response['description']['figures'], [])
        self.assertTrue(any(Draw['kind']=='line' and Draw['positions'] for Draw in Response['frame']['draws']))
        self.Command('tool cancel')

    def test_command_frame_never_contains_cpu_pixels(self):
        Response = self.Command('box (0,0,0) 2 3 4 --name=Block', 'select Block', 'gizmo on')
        self.assertNotIn('pixels', Response)
        Frame = Response['frame']
        self.assertEqual(Frame['cpuFragments'], 0)
        self.assertEqual(Frame['rgbaUploads'], 0)
        self.assertEqual(set(Draw['kind'] for Draw in Frame['draws']), {'lattice', 'surface', 'line'})
        self.assertTrue(any(Draw['overlay'] for Draw in Frame['draws']))
        Figure = Response['description']['figures'][0]
        self.assertEqual((Figure['faces'], Figure['edges'], Figure['vertices']), (6, 12, 8))
        self.assertEqual(Figure['high'], [2, 3, 4])

    def test_every_original_example_executes_current_cpp(self):
        Script = "import {Examples} from './Experimental/SolidArc/src/CommandSpecification.js'; console.log(JSON.stringify(Examples));"
        Examples = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', Script], cwd=Root))
        for Name, Example in Examples.items():
            with self.subTest(Name=Name):
                Commands=(Root/'Experimental/SolidArc/public'/Example['file']).read_text().splitlines() if Example.get('file') else Example['commands']
                Commands=[c for c in Commands if c.strip() and not c.startswith('#')]
                Response = self.Command('reset', *Commands)
                self.assertTrue(Response['description']['figures'])

    def test_all_thirty_one_construct_entries(self):
        Script = "import {ConstructionCatalogue} from './Experimental/SolidArc/src/ConstructionSpecification.js'; console.log(JSON.stringify(ConstructionCatalogue.map((Entry,Index)=>[Entry.label,Entry.command(0,0)])));"
        Commands = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', Script], cwd=Root))
        self.assertEqual(len(Commands), 31)
        for Name, Command in Commands:
            with self.subTest(Name=Name):
                Response = self.Command('reset', Command)
                self.assertEqual(len(Response['description']['figures']), 1)

    def test_explicit_curves_are_atomic_undoable_and_rational(self):
        cases=['hermite (0,0) (3,0) (0,3) (3,3)',
               'bezier (0,0) (0,3) (3,3) (3,0)',
               'bspline (0,0) (0,3) (3,3) (3,0) --degree=2',
               'nurbs (0,0) (1,2) (2,0) --degree=2 --weights=1,3,1']
        for case in cases:
            with self.subTest(case=case):
                result=self.Command('reset','draw '+case)['description']
                self.assertEqual(len(result['figures']),1)
                self.assertEqual(len(result['history']),1)
                self.assertEqual(len(self.Command('undo')['description']['figures']),0)
                self.assertEqual(len(self.Command('redo')['description']['figures']),1)
        unit=self.Command('reset','draw nurbs (0,0) (1,2) (2,0) --degree=2')
        weighted=self.Command('reset','draw nurbs (0,0) (1,2) (2,0) --degree=2 --weights=1,3,1')
        peak=lambda r:max(y for d in r['frame']['draws'] if d['kind']=='line' and not d.get('overlay') for y in d['positions'][1::3])
        self.assertGreater(peak(weighted),peak(unit)+.4)
        for suffix in ['--weights=1,0,1','--weights=1,-2,1','--weights=1,nan,1','--weights=1,2','--weights=1,2,','--degree=8','--degree=2.5']:
            before=self.Exchange()['description']['figures']
            result=self.Exchange('command',commands=['draw nurbs (0,0) (1,2) (2,0) '+suffix])
            self.assertFalse(result['success'],suffix)
            self.assertEqual(result['description']['figures'],before)

    def test_live_dimensions_undo_redo(self):
        Response = self.Command('box (0,0,0) 2 3 4 --name=Block', 'dim auto')
        Dimension = next(Item for Item in Response['description']['dimensions'] if Item['slot'] == 5)
        Response = self.Command(f"dim edit {Dimension['id']} 6")
        self.assertEqual(Response['description']['figures'][0]['high'][2], 6)
        self.assertEqual(self.Command('undo')['description']['figures'][0]['high'][2], 4)
        self.assertEqual(self.Command('redo')['description']['figures'][0]['high'][2], 6)

    def test_region_extrusion_preserves_hole(self):
        Response = self.Command('circle (0,0) 1 --name=Outer', 'circle (0,0) 0.4 --name=Inner')
        Region = next(Item for Item in Response['description']['areas'] if Item['holes'] == 1)
        Response = self.Command(f"extrude a{Region['id']} 1")
        Body = next(Item for Item in Response['description']['figures'] if Item['classification'] == 2)
        self.assertEqual(Body['faces'], 4)

    def test_native_save_open_and_malformed_input(self):
        Before = self.Command('box (0,0,0) 2 3 4 --name=Saved')['description']['figures']
        File = self.Exchange('save')['file']
        self.Command('reset')
        self.assertTrue(self.Exchange('open', text=File)['success'])
        self.assertEqual(self.Exchange()['description']['figures'], Before)
        Response = self.Exchange('open', text='not a native SolidArc document')
        self.assertFalse(Response['success'])
        self.assertEqual(Response['description']['figures'], Before)

    def test_independent_native_documents(self):
        First = self.Identity
        self.Command('box (0,0,0) 1 2 3 --name=First')
        self.Identity = self.Exchange('create')['description']['identity']
        self.Command('sphere (0,0,0) 1 --name=Second')
        self.assertEqual(self.Exchange()['description']['figures'][0]['name'], 'Second')
        self.Identity = First
        self.assertEqual(self.Exchange()['description']['figures'][0]['name'], 'First')

    def test_export_is_real_tessellated_obj(self):
        self.Command('box (0,0,0) 1 2 3')
        Response = self.Exchange('export')
        self.assertTrue(Response['success'])
        self.assertRegex(Response['file'], r'(?m)^v ')
        self.assertRegex(Response['file'], r'(?m)^f ')

    def test_orbit_changes_shared_camera_matrices(self):
        Before = self.Command('sphere (0,0,0) 1')['frame']['view']['ViewClip']
        After = self.Exchange('orbit', x=0.3, y=0.1)['frame']['view']['ViewClip']
        self.assertNotEqual(Before, After)

    def test_control_poles_have_gpu_point_commands(self):
        Response = self.Command('cpcurve (0,0) (1,2) (3,-1) (5,1) --name=Profile', 'select Profile', 'selectmode control', 'show cages on')
        Points = [Draw for Draw in Response['frame']['draws'] if Draw['kind'] == 'point']
        self.assertTrue(Points)
        Draw = next(Draw for Draw in Points if Draw['pick'])
        Response = self.Exchange('pick', x=10, y=20, intersection=Draw['pick'])
        self.assertEqual(len(Response['description']['figures'][0]['pickedPoles']), 1)

    def test_camera_synchronization_does_not_edit_geometry_or_undo(self):
        Before = self.Command('box (0,0,0) 1 2 3 --name=CameraProof')
        Camera = dict(Before['description']['camera'])
        Camera['yaw'] += 0.25
        Camera['pitch'] -= 0.1
        Camera['pivot'] = [2.0, 3.0, 1.0]
        After = self.Exchange('render', camera=Camera)
        self.assertEqual(After['description']['figures'], Before['description']['figures'])
        self.assertEqual(After['description']['history'], Before['description']['history'])
        self.assertAlmostEqual(After['description']['camera']['yaw'], Camera['yaw'], places=10)
        self.assertEqual(After['description']['camera']['pivot'], Camera['pivot'])
        self.assertNotEqual(After['frame']['view']['ViewClip'], Before['frame']['view']['ViewClip'])

    def test_refused_geometry_preserves_scene(self):
        Before = self.Command('sphere (0,0,0) 1 --name=Ball')['description']['figures']
        Response = self.Exchange('command', commands=['shell Ball 0.1 --face=999'])
        self.assertFalse(Response['success'])
        self.assertEqual(Response['description']['figures'], Before)

    def test_synthetic_identity_runs_drive_box_selection(self):
        Response = self.Command('box (-3,0,0) 1 1 1 --name=Left', 'box (2,0,0) 1 1 1 --name=Right', 'gizmo off')
        Left, Right = Response['description']['figures']
        Runs = f"800\n8010 10 {Left['id']}\n8420 10 {Right['id']}"
        Response = self.Exchange('command', commands=['select box 0 0 100 100'], intersectionRuns=Runs)
        self.assertEqual([Item['name'] for Item in Response['description']['figures'] if Item['selected']], ['Left'])


if __name__ == '__main__':
    unittest.main(verbosity=2)

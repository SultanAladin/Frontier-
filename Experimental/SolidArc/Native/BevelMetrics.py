"""Native bevel transactions/history plus the existing geometry regression suite."""
import unittest
import GeometryMetrics as Geometry

class BevelMetrics(Geometry.GeometryMetrics):
    def Fixture(self, Sketch=False):
        R=self.Command('reset', 'rect (0,0,0) (4,4,0) --name=Source' if Sketch else 'box (0,0,0) (4,4,4) --name=Source', 'select Source' if Sketch else 'select edges Source 0')
        return R['description']['figures'][0]['id']
    def Bevel(self, Op, **Values):
        return self.Exchange('bevel',operation=Op,**Values)
    def test_parallel_native_sessions_do_not_share_import_export_files(self):
        import concurrent.futures,json,subprocess
        def Session(N):
            Text='# SolidArc native document v1\nbox (0,0,0) ('+str(N)+',2,3) --name=Concurrent'+str(N)+'\n'
            Input=''.join(json.dumps(R)+'\n' for R in [dict(action='create'),dict(action='open',text=Text),dict(action='save')])
            P=subprocess.run([str(Geometry.Root/'_AgentScratch/build/SolidArcNative/GeometryHost')],cwd=Geometry.Root,input=Input,text=True,capture_output=True,check=True)
            Packets=[json.loads(L[16:]) for L in P.stdout.splitlines() if L.startswith('SOLIDARC_PACKET ')]
            self.assertTrue(all(R['success'] for R in Packets));self.assertEqual(Packets[-1]['description']['figures'][0]['name'],'Concurrent'+str(N));self.assertIn('--name=Concurrent'+str(N),Packets[-1]['file'])
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as Pool:list(Pool.map(Session,range(2,6)))
    def MixedCorner(self):
        Text=(Geometry.Root/'Experimental/SolidArc/Native/Fixtures/MixedCapCorner.arc').read_text()
        R=self.Exchange('open',text=Text);self.assertTrue(R['success'],R['lines']);return R['description']['figures'][-1]['id']
    def test_mixed_arc_line_corner_both_modes_undo_save_and_reopen(self):
        for Chamfer in (False,True):
            Id=self.MixedCorner();Before=self.Exchange()['description'];self.Bevel(0)
            R=self.Bevel(1,size=.0202791507347,chamfer=Chamfer);self.assertTrue(R['success'],R['description']['bevel'])
            self.assertEqual(Before['figures'],R['description']['figures']);R=self.Bevel(2);self.assertTrue(R['success'])
            F=R['description']['figures'][-1];self.assertEqual((F['faces'],F['edges'],F['vertices']),(11,25,16))
            self.assertEqual(len(F['bevelFeatures']),3);self.assertEqual(F['bevelFeatures'][-1]['count'],2)
            self.assertEqual(F['bevelFeatures'][-1]['mode'],'chamfer' if Chamfer else 'fillet')
            Saved=self.Exchange('save')['file'];self.assertEqual(self.Command('undo')['description']['figures'],Before['figures'])
            self.assertEqual(self.Command('redo')['description']['figures'][-1],F)
            self.Command('reset');R=self.Exchange('open',text=Saved);self.assertTrue(R['success']);self.assertEqual(R['description']['figures'][-1],F)
            self.assertTrue(self.Bevel(0,owner=Id,feature=3)['success']);self.assertTrue(self.Bevel(1,size=.025,chamfer=not Chamfer)['success']);self.assertTrue(self.Bevel(2)['success'])
    def test_mixed_corner_refusals_are_atomic_and_recover(self):
        self.MixedCorner();Before=self.Exchange()['description'];self.Bevel(0)
        for Chamfer in (False,True):
            R=self.Bevel(1,size=.2,chamfer=Chamfer);self.assertFalse(R['success']);self.assertFalse(R['description']['bevel']['valid'])
            self.assertFalse(self.Bevel(2)['success']);self.assertEqual(Before['figures'],self.Exchange()['description']['figures'])
        self.assertTrue(self.Bevel(1,size=.02)['success']);self.Bevel(3)
        After=self.Exchange()['description'];self.assertEqual(Before['figures'],After['figures']);self.assertEqual(Before['history'],After['history'])
    def test_mixed_corner_editing_prior_feature_replays_all_three(self):
        Id=self.MixedCorner();self.Bevel(0);self.Bevel(1,size=.0202791507347);self.Bevel(2)
        Before=self.Exchange()['description']['figures'];self.Bevel(0,owner=Id,feature=2)
        R=self.Bevel(1,size=.18);self.assertTrue(R['success'],R['description']['bevel']);self.assertTrue(self.Bevel(2)['success'])
        F=self.Exchange()['description']['figures'][-1];self.assertEqual([B['size'] for B in F['bevelFeatures']],[.2582021677,.18,.0202791507347])
        self.assertEqual(self.Command('undo')['description']['figures'],Before)
    def test_mixed_corner_single_arc_selection_expands_and_order_is_stable(self):
        for Edges in ('14','14 15','15 14'):
            Id=self.MixedCorner();self.Command('select none',f'select edges {Id} {Edges}')
            self.Bevel(0);self.assertTrue(self.Bevel(1,size=.02)['success']);R=self.Bevel(2);self.assertTrue(R['success'])
            self.assertEqual((R['description']['figures'][-1]['faces'],R['description']['figures'][-1]['edges']),(11,25))

    def test_bevel_preview_is_not_authored_or_undo_history(self):
        self.Fixture();Before=self.Exchange()['description'];R=self.Bevel(0)
        self.assertTrue(R['success']);self.assertTrue(R['description']['bevel']['valid'])
        self.assertEqual(Before['figures'],R['description']['figures']);self.assertEqual(Before['history'],R['description']['history'])
        R=self.Bevel(1,size=.3);self.assertTrue(R['success']);self.assertFalse(R['dirty'])
        self.assertNotEqual(self.Exchange()['frame']['draws'],self.Bevel(3)['frame']['draws'])
        R=self.Exchange();self.assertEqual(Before['figures'],R['description']['figures']);self.assertEqual(Before['history'],R['description']['history'])
    def test_bevel_commit_stable_identity_and_one_undo_redo(self):
        Id=self.Fixture();Before=self.Exchange()['description'];self.Bevel(0);R=self.Bevel(2)
        self.assertTrue(R['success']);F=R['description']['figures'][0]
        self.assertEqual(F['id'],Id);self.assertEqual(F['name'],'Source');self.assertEqual(len(F['bevelFeatures']),1);self.assertGreater(F['faces'],6)
        self.assertEqual(len(R['description']['history']),len(Before['history'])+1)
        self.assertEqual(self.Command('undo')['description']['figures'],Before['figures'])
        self.assertEqual(len(self.Command('redo')['description']['figures'][0]['bevelFeatures']),1)
    def test_bevel_3d_multi_edge_and_unsupported_set_atomic(self):
        Id=self.Fixture();self.Command(f'select edges {Id} 0 4');self.Bevel(0,chamfer=True)
        self.assertTrue(self.Bevel(1,size=.2,chamfer=True)['success']);R=self.Bevel(2)
        self.assertTrue(R['success']);self.assertEqual(R['description']['figures'][0]['bevelFeatures'][0]['count'],2)
        self.Command('reset','cylinder (0,0,0) 2 4 --name=Source','select edges Source all');Before=self.Exchange()['description'];self.Bevel(0)
        R=self.Bevel(1,size=.2);self.assertFalse(R['success']);self.assertFalse(self.Bevel(2)['success']);self.Bevel(3)
        self.assertEqual(Before['figures'],self.Exchange()['description']['figures'])
    def test_bevel_2d_fillet_and_chamfer(self):
        for Chamfer in (False,True):
            self.Fixture(True);self.Bevel(0,chamfer=Chamfer);R=self.Bevel(1,size=.25,chamfer=Chamfer)
            self.assertTrue(R['success'],R['description']['bevel']);R=self.Bevel(2)
            self.assertTrue(R['success']);F=R['description']['figures'][0]
            self.assertEqual(F['bevelFeatures'][0]['count'],4);self.assertGreater(F['poles'],5)
            self.assertEqual(F['bevelFeatures'][0]['mode'],'chamfer' if Chamfer else 'fillet')
    def test_bevel_invalid_preview_disables_commit(self):
        self.Fixture(True);Before=self.Exchange()['description'];self.Bevel(0)
        for Size in (0,-1,1000):
            R=self.Bevel(1,size=Size);self.assertFalse(R['success']);self.assertFalse(R['description']['bevel']['valid'])
            self.assertFalse(self.Bevel(2)['success']);self.assertEqual(self.Exchange()['description']['figures'],Before['figures'])
        self.assertTrue(self.Bevel(1,size=.1)['success']);self.assertTrue(self.Bevel(2)['success'])
    def test_bevel_2d_no_silent_partial_corner_collision(self):
        self.Command('reset','polyline (0,0,0) (1,0,0) (1,4,0) (0,4,0) --closed --name=Source','select Source')
        Before=self.Exchange()['description'];self.Bevel(0)
        R=self.Bevel(1,size=.6,chamfer=True);self.assertFalse(R['success']);self.assertIn('overlap',R['description']['bevel']['status'])
        self.Bevel(3);self.assertEqual(Before['figures'],self.Exchange()['description']['figures'])
    def test_bevel_multi_object_atomic_refusal(self):
        self.Command('reset','rect (0,0,0) (4,4,0) --name=Large','rect (8,0,0) (8.2,.2,0) --name=Small','select Large Small')
        Before=self.Exchange()['description'];self.Bevel(0);R=self.Bevel(1,size=.5,chamfer=True)
        self.assertFalse(R['success']);self.Bevel(3);After=self.Exchange()['description']
        self.assertEqual(Before['figures'],After['figures']);self.assertEqual(Before['history'],After['history'])
    def test_bevel_multi_object_commit_single_transaction(self):
        self.Command('reset','rect (0,0,0) (4,4,0) --name=A','rect (8,0,0) (12,4,0) --name=B','select A B')
        Before=self.Exchange()['description'];self.Bevel(0);R=self.Bevel(2)
        self.assertTrue(R['success']);self.assertTrue(all(len(F['bevelFeatures'])==1 for F in R['description']['figures']))
        self.assertEqual(len(Before['history'])+1,len(R['description']['history']));self.assertEqual(self.Command('undo')['description']['figures'],Before['figures'])
    def test_bevel_saved_reopened_editable_feature(self):
        Id=self.Fixture();self.Bevel(0);self.Bevel(2);self.Bevel(0,owner=Id,feature=1);self.Bevel(1,size=.31,chamfer=True);self.Bevel(2)
        Before=self.Exchange()['description']['figures'];Text=self.Exchange('save')['file']
        self.assertIn('beveladd',Text);self.assertIn('beveledit',Text);self.assertNotIn('bevel-options',Text)
        self.Command('reset');R=self.Exchange('open',text=Text);self.assertTrue(R['success']);self.assertEqual(Before,R['description']['figures'])
        self.assertTrue(self.Bevel(0,owner=Id,feature=1)['success'])
    def test_bevel_two_corner_features_edit_first_replays_second(self):
        Id=self.Fixture(True)
        self.Command(f'beveladd .2 --mode=chamfer --targets={Id}:c0')
        # Remaining original corner at (4,4), geometrically distant from the first operation.
        self.Command(f'beveladd .25 --mode=chamfer --targets={Id}:c3')
        Before=self.Exchange()['description'];self.assertTrue(self.Bevel(0,owner=Id,feature=1)['success'])
        R=self.Bevel(1,size=.35,chamfer=True);self.assertTrue(R['success'],R['description']['bevel'])
        R=self.Bevel(2);self.assertTrue(R['success']);B=R['description']['figures'][0]['bevelFeatures']
        self.assertEqual([b['size'] for b in B],[.35,.25]);self.assertTrue(all(b['editable'] for b in B))
        self.assertEqual(self.Command('undo')['description']['figures'],Before['figures'])
    def test_bevel_downstream_ambiguity_refuses_atomically(self):
        Id=self.Fixture(True);self.Command(f'beveladd .2 --mode=chamfer --targets={Id}:c0',f'beveladd .05 --mode=chamfer --targets={Id}:c0')
        Before=self.Exchange()['description'];self.Bevel(0,owner=Id,feature=1)
        R=self.Bevel(1,size=.4,chamfer=True);self.assertFalse(R['success']);self.assertIn('downstream',R['description']['bevel']['status'].lower())
        self.Bevel(3);self.assertEqual(Before['figures'],self.Exchange()['description']['figures'])
    def test_bevel_rigid_transform_keeps_editable_history(self):
        Id=self.Fixture();self.Bevel(0);self.Bevel(2);self.Command('transform selected --move=(3,2,1)')
        R=self.Bevel(0,owner=Id,feature=1);self.assertTrue(R['success'],R['description']['bevel'])
        self.assertTrue(self.Bevel(1,size=.3)['success']);R=self.Bevel(2);self.assertTrue(R['success']);self.assertGreater(R['description']['figures'][0]['low'][0],2.9)
    def test_bevel_nonuniform_transform_is_not_silently_erased(self):
        Id=self.Fixture();self.Bevel(0);self.Bevel(2);R=self.Command('transform selected --scale=(2,1,1)')
        self.assertFalse(R['description']['figures'][0]['bevelFeatures'][0]['editable'])
        Before=R['description']['figures'];self.assertFalse(self.Bevel(0,owner=Id,feature=1)['success']);self.assertEqual(self.Exchange()['description']['figures'],Before)
    def test_bevel_unsupported_curves_and_wrong_selection(self):
        for Fixture in ('circle (0,0,0) 2 --name=Source','line (0,0,0) (4,0,0) --name=Source','box (0,0,0) (4,4,4) --name=Source'):
            self.Command('reset',Fixture,'select Source');R=self.Bevel(0);self.assertFalse(R['success']);self.assertFalse(R['description']['bevel']['active'])
    def test_bevel_canonical_invalid_indices_do_not_change_anything(self):
        Id=self.Fixture(True);Before=self.Exchange()['description']
        for Targets in (f'{Id}:c999',f'{Id}:c0,0',f'{Id}:c-1',f'{Id}:c1e100',f'{Id}:c'):
            R=self.Exchange('command',commands=[f'beveladd .2 --mode=chamfer --targets={Targets}']);self.assertFalse(R['success'],Targets)
            self.assertEqual(Before['figures'],R['description']['figures']);self.assertEqual(Before['history'],R['description']['history'])

if __name__=='__main__':unittest.main(verbosity=2)

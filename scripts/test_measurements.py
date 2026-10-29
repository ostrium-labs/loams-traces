import unittest
from measurements import measurement
class IntegrityTests(unittest.TestCase):
 def test_failed_requests_never_become_successful_qps(self):
  self.assertIsNone(measurement({'qps':1000,'ok':0,'errors':{'timeout':8}}, {})['rate'])
 def test_verified_completions_are_separate_from_raw_qps(self):
  self.assertEqual(measurement({'successful_qps':42,'qps':999,'errors':0},{})['rate'],42)
 def test_workflows_keep_their_unit(self):
  self.assertEqual(measurement({'throughput_wf_s':2,'failed':0},{})['unit'],'workflows/s')
if __name__=='__main__':unittest.main()

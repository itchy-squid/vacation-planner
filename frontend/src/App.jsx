import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { PlannerProvider } from "./state/PlannerContext";
import TripsHome from "./pages/TripsHome";
import NewTrip from "./pages/NewTrip";
import NewPin from "./pages/NewPin";
import TripSettings from "./pages/TripSettings";
import PinBoard from "./pages/PinBoard";
import LassoMap from "./pages/LassoMap";
import DaySchedule from "./pages/DaySchedule";
import CompareSets from "./pages/CompareSets";
import EditVisit from "./pages/EditVisit";
import FinalItinerary from "./pages/FinalItinerary";
import DevNav from "./dev/DevNav";

export default function App() {
  return (
    <PlannerProvider>
      <BrowserRouter>
        <div className="app-viewport">
          <Routes>
            <Route path="/" element={<TripsHome />} />
            <Route path="/new-trip" element={<NewTrip />} />
            <Route path="/board" element={<PinBoard />} />
            <Route path="/new-pin" element={<NewPin />} />
            <Route path="/trip-settings" element={<TripSettings />} />
            <Route path="/map" element={<LassoMap />} />
            <Route path="/schedule" element={<Navigate to="/schedule/5" replace />} />
            <Route path="/schedule/:day" element={<DaySchedule />} />
            <Route path="/compare" element={<CompareSets />} />
            <Route path="/edit/:pinId" element={<EditVisit />} />
            <Route path="/itinerary" element={<FinalItinerary />} />
          </Routes>
        </div>
        <DevNav />
      </BrowserRouter>
    </PlannerProvider>
  );
}

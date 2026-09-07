import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
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

// Every trip-scoped screen lives under /trips/:tripId/... so a URL always
// carries which trip it's about — paste a link to someone else and it
// opens their browser straight into the same trip (see
// state/PlannerContext.jsx, which reads :tripId off the URL at load time).
// Only Trips Home and the new-trip form are trip-agnostic.
function ScheduleIndexRedirect() {
  const { tripId } = useParams();
  return <Navigate to={`/trips/${tripId}/schedule/5`} replace />;
}

export default function App() {
  return (
    <PlannerProvider>
      <BrowserRouter>
        <div className="app-viewport">
          <Routes>
            <Route path="/" element={<TripsHome />} />
            <Route path="/new-trip" element={<NewTrip />} />
            <Route path="/trips/:tripId/board" element={<PinBoard />} />
            <Route path="/trips/:tripId/new-pin" element={<NewPin />} />
            <Route path="/trips/:tripId/trip-settings" element={<TripSettings />} />
            <Route path="/trips/:tripId/map" element={<LassoMap />} />
            <Route path="/trips/:tripId/schedule" element={<ScheduleIndexRedirect />} />
            <Route path="/trips/:tripId/schedule/:day" element={<DaySchedule />} />
            <Route path="/trips/:tripId/compare" element={<CompareSets />} />
            <Route path="/trips/:tripId/edit/:pinId" element={<EditVisit />} />
            <Route path="/trips/:tripId/itinerary" element={<FinalItinerary />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <DevNav />
      </BrowserRouter>
    </PlannerProvider>
  );
}
